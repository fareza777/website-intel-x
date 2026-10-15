"""Causal indicators and deliberately conservative spot-long simulations.

No vectorized future shifts, fit-on-all-data scalers, or offline regime labels
enter a decision. Each decision at close t can first execute at open t+1.
"""

from __future__ import annotations

import math
from bisect import bisect_right
from dataclasses import dataclass

from .market import Candle


def ema(values: list[float], period: int) -> list[float | None]:
    if period < 1:
        raise ValueError("EMA period must be positive")
    result: list[float | None] = [None] * len(values)
    if len(values) < period:
        return result
    previous = sum(values[:period]) / period
    result[period - 1] = previous
    alpha = 2 / (period + 1)
    for i in range(period, len(values)):
        previous = alpha * values[i] + (1 - alpha) * previous
        result[i] = previous
    return result


def rsi(values: list[float], period: int = 14) -> list[float | None]:
    """Wilder smoothing; SMA of first N differences; a flat tape is RSI 50."""
    if period < 1:
        raise ValueError("RSI period must be positive")
    result: list[float | None] = [None] * len(values)
    if len(values) <= period:
        return result
    differences = [b - a for a, b in zip(values, values[1:])]
    gain = sum(max(d, 0) for d in differences[:period]) / period
    loss = sum(max(-d, 0) for d in differences[:period]) / period
    for i in range(period, len(values)):
        if i > period:
            difference = differences[i - 1]
            gain = ((period - 1) * gain + max(difference, 0)) / period
            loss = ((period - 1) * loss + max(-difference, 0)) / period
        result[i] = 50 if gain == loss == 0 else (100 if loss == 0 else 100 - 100 / (1 + gain / loss))
    return result


def atr(candles: list[Candle], period: int = 14) -> list[float | None]:
    """Wilder ATR excludes bar zero, whose prior close is unknown."""
    if period < 1:
        raise ValueError("ATR period must be positive")
    result: list[float | None] = [None] * len(candles)
    if len(candles) <= period:
        return result
    ranges = [max(c.high - c.low, abs(c.high - previous.close), abs(c.low - previous.close))
              for previous, c in zip(candles, candles[1:])]
    previous = sum(ranges[:period]) / period
    result[period] = previous
    for i in range(period + 1, len(candles)):
        previous = ((period - 1) * previous + ranges[i - 1]) / period
        result[i] = previous
    return result


@dataclass(frozen=True)
class Decision:
    enter: bool
    exit: bool
    stop: float
    target: float


@dataclass(frozen=True)
class Trade:
    entry_index: int
    exit_index: int
    decision_time: int
    entry_fill: float
    exit_fill: float
    net_return: float
    pnl: float
    reason: str


@dataclass
class Simulation:
    final_equity: float
    trades: list[Trade]
    equity: list[tuple[int, float]]


def build_decisions(hourly: list[Candle], higher: list[Candle], strategy: str) -> list[Decision]:
    if strategy not in {"momentum", "pullback"}:
        raise ValueError("Unknown strategy")
    closes = [c.close for c in hourly]
    fast, slow, strength, volatility = ema(closes, 21), ema(closes, 50), rsi(closes), atr(hourly)
    higher_average = ema([c.close for c in higher], 21)
    higher_closes = [c.close_time for c in higher]
    result = []
    for i, candle in enumerate(hourly):
        # As-of join uses close_time, never the opening timestamp of a still-open 4H bar.
        h = bisect_right(higher_closes, candle.close_time) - 1
        ready = (i > 0 and all(v is not None for v in (fast[i], slow[i], strength[i], strength[i-1], volatility[i]))
                 and h >= 0 and higher_average[h] is not None)
        if not ready:
            result.append(Decision(False, False, 0, 0))
            continue
        trend = higher[h].close > higher_average[h]
        if strategy == "momentum":
            enter = trend and candle.close > fast[i] > slow[i] and 50 <= strength[i] <= 68
            exit_now = candle.close < fast[i] or strength[i] < 45
            risk_multiple = 2.0
        else:
            enter = trend and candle.close > slow[i] and strength[i-1] < 40 <= strength[i]
            exit_now = candle.close < slow[i] or strength[i] >= 65
            risk_multiple = 1.5
        risk = risk_multiple * volatility[i]
        result.append(Decision(bool(enter), bool(exit_now), candle.close - risk, candle.close + 2 * risk))
    return result


def simulate(candles: list[Candle], decisions: list[Decision], start: int, end: int, *,
             initial_cash: float = 1000, fee_bps: float = 10, slippage_bps: float = 5,
             max_holding: int = 72) -> Simulation:
    """One unlevered position. Predeclared fold end liquidates at final bar open.

    Targets are skipped on entry bars; stops remain active. Subsequent ambiguous
    OHLC bars stop first. Stops gap at the worse open; targets get no gap windfall.
    Mark-to-market equity includes the estimated exit fee and slippage.
    """
    if len(candles) != len(decisions) or not 1 <= start < end <= len(candles):
        raise ValueError("Simulation range or decision alignment is invalid")
    if (initial_cash <= 0 or not math.isfinite(initial_cash)
            or not 0 <= fee_bps < 10000 or not 0 <= slippage_bps < 10000 or max_holding < 1):
        raise ValueError("Invalid simulation cash, costs, or holding period")
    fee, slip = fee_bps / 10000, slippage_bps / 10000
    cash = initial_cash
    position = None
    trades: list[Trade] = []
    equity = [(candles[start - 1].close_time, cash)]
    for i in range(start, end):
        candle, previous = candles[i], decisions[i - 1]
        exit_price, reason = None, ""
        if position is not None:
            if candle.open <= position["stop"]:
                exit_price, reason = candle.open, "STOP GAP"
            elif candle.open >= position["target"]:
                exit_price, reason = position["target"], "TARGET GAP"
            elif i == end - 1:
                exit_price, reason = candle.open, "FOLD END"
            elif previous.exit:
                exit_price, reason = candle.open, "SIGNAL"
            elif i - position["entry_index"] >= max_holding:
                exit_price, reason = candle.open, "TIME"
            elif candle.low <= position["stop"]:
                exit_price, reason = position["stop"], "STOP"
            elif candle.high >= position["target"]:
                exit_price, reason = position["target"], "TARGET"
        elif (i < end - 1 and previous.enter and 0 < previous.stop < candle.open < previous.target):
            entry_fill = candle.open * (1 + slip)
            if entry_fill < previous.target:
                quantity = cash / (entry_fill * (1 + fee))
                position = {"entry_index": i, "decision_time": candles[i-1].close_time,
                            "entry_fill": entry_fill, "quantity": quantity, "initial_cash": cash,
                            "stop": previous.stop, "target": previous.target}
                cash = 0
                if candle.low <= previous.stop:
                    exit_price, reason = previous.stop, "STOP"
        if position is not None and exit_price is not None:
            fill = exit_price * (1 - slip)
            cash = position["quantity"] * fill * (1 - fee)
            pnl = cash - position["initial_cash"]
            trades.append(Trade(position["entry_index"], i, position["decision_time"],
                                position["entry_fill"], fill, pnl / position["initial_cash"], pnl, reason))
            position = None
        # Exiting a position never re-enters on the same bar.
        marked = cash if position is None else position["quantity"] * candle.close * (1 - slip) * (1 - fee)
        equity.append((candle.close_time, marked))
    if position is not None:
        raise RuntimeError("A simulation must finish flat")
    return Simulation(cash, trades, equity)


def max_drawdown(values: list[float]) -> float:
    peak, worst = 0.0, 0.0
    for value in values:
        peak = max(peak, value)
        if peak > 0:
            worst = max(worst, (peak - value) / peak)
    return worst * 100


def summarize(trades: list[Trade], equity: list[float]) -> dict:
    winners = sum(t.pnl for t in trades if t.pnl > 0)
    losses = -sum(t.pnl for t in trades if t.pnl < 0)
    return {"trades": len(trades),
            "winRate": 100 * sum(t.net_return > 0 for t in trades) / len(trades) if trades else None,
            "profitFactor": winners / losses if losses > 0 else None,
            "expectancy": 100 * sum(t.net_return for t in trades) / len(trades) if trades else None,
            "maxDrawdown": max_drawdown(equity),
            "totalReturn": (equity[-1] / equity[0] - 1) * 100 if equity else 0}


def walk_forward_folds(length: int, *, warmup: int = 200, folds: int = 3) -> list[tuple[int, int, int, int]]:
    if folds < 1 or length < warmup + 120:
        raise ValueError("Insufficient closed candles for chronological train/test folds")
    first_test = warmup + (length - warmup) // 2
    edges = [first_test + (length - first_test) * i // folds for i in range(folds + 1)]
    if any(b - a < 2 for a, b in zip(edges, edges[1:])):
        raise ValueError("Test folds must contain at least two candles")
    return [(warmup, start, start, end) for start, end in zip(edges, edges[1:])]
