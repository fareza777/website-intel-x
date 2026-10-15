"""AnalyticsReport serialization and chronological comparison of fixed rules."""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from .core import build_decisions, ema, simulate, summarize, walk_forward_folds
from .market import BASE_URL, Candle, INTERVALS, MarketDataError, validate_history


def iso(milliseconds: int) -> str:
    return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def build_report(symbol: str, hourly: list[Candle], higher: list[Candle], *,
                 generated_ms: int | None = None, optional: bool = True) -> dict:
    validate_history(hourly, INTERVALS["1h"])
    validate_history(higher, INTERVALS["4h"])
    if len(hourly) < 400 or len(higher) < 60:
        raise MarketDataError("At least 400 closed 1H and 60 closed 4H candles are required")
    if higher[0].close_time > hourly[200].close_time:
        raise MarketDataError("4H history does not cover the evaluation start")
    folds = walk_forward_folds(len(hourly))
    notes = [
        "Real closed Binance spot 1H/4H OHLCV; no fabricated history or trade execution.",
        "Two fixed rules; no parameter optimization. 200 hourly bars warm up indicators; "
        "the next half initializes training, then three expanding-train / disjoint-test folds run chronologically.",
        "All returns, win rate, drawdown and expectancy use percentage points; profit factor is a ratio. "
        "Expectancy is mean net trade return. Undefined win rate, profit factor or expectancy is null.",
        "Equity, trade statistics, totalReturn and testReturn cover only concatenated nonoverlapping test folds. "
        "trainReturn is the arithmetic mean of overlapping expanding-training fold returns, never their sum.",
        "Decisions use close t and only 4H candles closed by t; entries and signal exits use open t+1. "
        "Fee 10 bps plus adverse slippage 5 bps on each side. One unlevered position, all available cash, "
        "fractional quantities; exchange lot/tick rounding and capacity are not modeled.",
        "Stop-first for ambiguous OHLC; gap-through stops use the worse open. No target fill on an entry bar. "
        "Stops remain active. Targets receive no favorable gap fill. Maximum hold 72 hours; "
        "predeclared fold boundaries flatten at the final bar open with both exit costs.",
        "Drawdown uses hourly equity including estimated liquidation costs, not an intrabar worst-case path. "
        "No fees for idle cash, funding, shorting, leverage, tax or liquidity impact beyond fixed slippage.",
        "Degradation and low-sample flags are descriptive; these short, single-symbol folds do not prove "
        "robustness, eliminate overfitting, or estimate a probability of future profit.",
    ]
    strategies = []
    for identifier, name in (("momentum", "EMA 21/50 + RSI momentum"),
                             ("pullback", "EMA 50 + RSI pullback")):
        decisions = build_decisions(hourly, higher, identifier)
        train_returns = []
        cash, test_trades, curve = 1000.0, [], []
        for number, (train_start, train_end, test_start, test_end) in enumerate(folds, 1):
            train = simulate(hourly, decisions, train_start, train_end)
            train_return = (train.final_equity / 1000 - 1) * 100
            train_returns.append(train_return)
            test = simulate(hourly, decisions, test_start, test_end, initial_cash=cash)
            fold_return = (test.final_equity / cash - 1) * 100
            cash = test.final_equity
            test_trades.extend(test.trades)
            curve.extend(test.equity if not curve else test.equity[1:])
            notes.append(f"{name}, fold {number}: training {iso(hourly[train_start].time)} to "
                         f"{iso(hourly[train_end-1].close_time)}, {len(train.trades)} trades, {train_return:.3f}%; "
                         f"test {iso(hourly[test_start].time)} to {iso(hourly[test_end-1].close_time)}, "
                         f"{len(test.trades)} trades, {fold_return:.3f}% net.")
        statistics = summarize(test_trades, [value for _, value in curve])
        train_return = sum(train_returns) / len(train_returns)
        test_return = statistics["totalReturn"]
        low_sample = len(test_trades) < 30
        degradation = (train_return > 0 and test_return < train_return * .5) or (train_return >= 0 > test_return)
        strategies.append({"name": name, **statistics, "trainReturn": train_return,
                           "testReturn": test_return, "overfitWarning": low_sample or degradation,
                           "equity": [{"time": iso(time), "value": round(value, 6)} for time, value in curve]})
        if low_sample:
            notes.append(f"{name}: low sample ({len(test_trades)} out-of-sample trades; warning threshold 30).")
        if degradation:
            notes.append(f"{name}: out-of-sample degradation versus average training return; "
                         "durations differ, so this heuristic is not a statistical overfitting test.")
    closes = [c.close for c in hourly]
    fast, slow = ema(closes, 21)[-1], ema(closes, 50)[-1]
    current = "BULLISH" if closes[-1] > fast > slow else ("BEARISH" if closes[-1] < fast < slow else "SIDEWAYS")
    regime = {"current": current, "changePoints": [], "driftDetected": False,
              "method": "Causal EMA21/50 regime; optional offline change points / online drift unavailable"}
    if optional:
        from .optional import enrich
        enrich(hourly, strategies, regime, notes)
    else:
        notes.append("Optional packages disabled; standard-library indicators, folds and simulator remain active.")
    return {"generatedAt": iso(generated_ms if generated_ms is not None else int(datetime.now(timezone.utc).timestamp() * 1000)),
            "symbol": symbol, "dataSource": f"Binance public spot REST ({BASE_URL}); closed 1h/4h klines",
            "start": iso(hourly[0].time), "end": iso(hourly[-1].close_time),
            "strategies": strategies, "notes": notes, "regime": regime}


def write_report(destination: Path, report: dict) -> None:
    """Validate before replacing an existing report; never leave a partial JSON file."""
    serialized = json.dumps(report, separators=(",", ":"), allow_nan=False) + "\n"
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=destination.parent,
                                         prefix=destination.name + ".", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(serialized)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
