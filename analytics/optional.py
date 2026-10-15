"""Optional, audited research adapters. None can change strategy decisions.

Missing libraries or an incompatible upstream release produce explicit notes,
not fake detections or a replacement market series.
"""

from __future__ import annotations

import importlib
import math
from importlib.metadata import PackageNotFoundError, version

from .core import ema, rsi
from .market import Candle


load_module = importlib.import_module


def _version(distribution: str) -> str:
    try:
        return version(distribution)
    except PackageNotFoundError:
        return "unknown version"


def online_drift(returns: list[float], detector) -> tuple[bool, list[int]]:
    """Online volatility drift; 5% hourly move scales to 1, fixed before data.

    No full-sample standardization: a later observation cannot alter earlier
    inputs. Indices are detection times, not the start of a retrospectively fit regime.
    """
    detections = []
    for i, value in enumerate(returns):
        detector.update(min(abs(value) / .05, 1.0))
        if detector.drift_detected:
            detections.append(i)
    return bool(detections), detections


def retrospective_points(candles: list[Candle]) -> list[int]:
    """Offline PELT on at most 1000 recent returns; visualization only."""
    np, rpt = load_module("numpy"), load_module("ruptures")
    recent = candles[-1001:]
    returns = np.array([math.log(b.close / a.close) for a, b in zip(recent, recent[1:])])
    if len(returns) < 50 or float(returns.std()) == 0:
        return []
    features = np.column_stack((returns, np.abs(returns)))
    deviation = features.std(axis=0)
    deviation[deviation == 0] = 1
    features = (features - features.mean(axis=0)) / deviation
    points = rpt.Pelt(model="l2", min_size=24, jump=5).fit(features).predict(pen=3 * math.log(len(returns)))
    # A ruptures breakpoint is the exclusive end of a segment, not bar n.
    # Exclude its mandatory terminal marker and do not fabricate a future time.
    return [recent[index].close_time for index in points if 0 < index < len(returns)][:20]


def check_indicators(candles: list[Candle]) -> str:
    pd, ta = load_module("pandas"), load_module("pandas_ta_classic")
    closes = [c.close for c in candles]
    series = pd.Series(closes, dtype="float64")
    references = {"EMA": ta.ema(series, length=21, talib=False, sma=True),
                  "RSI": ta.rsi(series, length=14, talib=False)}
    implementations = {"EMA": ema(closes, 21), "RSI": rsi(closes, 14)}
    comparisons = []
    for name in ("EMA", "RSI"):
        errors = [abs(implementations[name][i] - float(references[name].iloc[i]))
                  for i in range(200, len(closes))
                  if implementations[name][i] is not None and math.isfinite(float(references[name].iloc[i]))]
        if not errors:
            comparisons.append(f"{name} UNAVAILABLE (no finite comparison values)")
            continue
        tolerance = max(closes) * 1e-10 if name == "EMA" else 1e-6
        maximum = max(errors)
        comparisons.append(f"{name} {'PASS' if maximum <= tolerance else 'DIFF'} "
                           f"(max absolute error {maximum:.3g}; tolerance {tolerance:.3g})")
    return (f"pandas-ta-classic {_version('pandas-ta-classic')} independent native reference check "
            f"after 200-bar warmup: {'; '.join(comparisons)}. "
            "Differences are reported; the optional reference never replaces strategy inputs.")


def risk_comparison(strategy: dict) -> str:
    pd, qs = load_module("pandas"), load_module("quantstats")
    values = pd.Series([point["value"] for point in strategy["equity"]],
                       index=pd.to_datetime([point["time"] for point in strategy["equity"]], utc=True),
                       dtype="float64")
    hourly_returns = values.pct_change().dropna()
    daily_returns = values.resample("1D").last().dropna().pct_change().dropna()
    maximum_drawdown = abs(float(qs.stats.max_drawdown(hourly_returns))) * 100
    sharpe = (float(qs.stats.sharpe(daily_returns, rf=0, periods=365))
              if len(daily_returns) > 1 and float(daily_returns.std()) > 0 else None)
    sharpe_text = f"{sharpe:.3f}" if sharpe is not None and math.isfinite(sharpe) else "undefined"
    drawdown_text = f"{maximum_drawdown:.3f}%" if math.isfinite(maximum_drawdown) else "undefined"
    return (f"QuantStats {_version('quantstats')}, {strategy['name']}: hourly equity max drawdown "
            f"{drawdown_text}; daily UTC Sharpe {sharpe_text} (365 periods/year, risk-free 0). "
            "Uses supplied costed out-of-sample equity only; no benchmark download or HTML report.")


def enrich(candles: list[Candle], strategies: list[dict], regime: dict, notes: list[str]) -> None:
    methods = ["Causal EMA21/50 current regime"]
    try:
        regime["changePoints"] = []
        points = retrospective_points(candles)
        from .report import iso
        regime["changePoints"] = [iso(time) for time in points]
        methods.append(f"ruptures {_version('ruptures')} PELT(l2), RETROSPECTIVE ONLY")
        notes.append("ruptures offline visualization: at most 1000 recent closed 1H log-return / "
                     "absolute-return observations, full-window standardization, PELT l2 penalty 3*log(n), "
                     "minimum segment 24 hours; terminal marker excluded. Never used for entries or validation.")
    except Exception as error:
        methods.append("ruptures unavailable")
        notes.append(f"ruptures unavailable ({type(error).__name__}); retrospective change points omitted.")
    try:
        drift = load_module("river.drift")
        returns = [math.log(b.close / a.close) for a, b in zip(candles, candles[1:])]
        detected, indices = online_drift(returns, drift.ADWIN(delta=.002))
        regime["driftDetected"] = detected
        methods.append(f"River {_version('river')} ADWIN online volatility drift")
        from .report import iso
        times = ", ".join(iso(candles[i+1].close_time) for i in indices[:10]) or "none"
        notes.append("River ADWIN receives abs(hourly log return)/0.05 clipped to [0,1], "
                     "one closed candle at a time; no fitted full-sample scaling. driftDetected means "
                     f"at least one alert in the analyzed window; detection times: {times}. "
                     "Drift is descriptive and does not enter strategy decisions.")
    except Exception as error:
        methods.append("River unavailable")
        notes.append(f"River unavailable ({type(error).__name__}); driftDetected=false means not evaluated.")
    try:
        notes.append(check_indicators(candles))
    except Exception as error:
        notes.append(f"pandas-ta-classic unavailable ({type(error).__name__}); independent reference check skipped.")
    try:
        # Ensure absence is visible even when no strategies were supplied.
        load_module("quantstats")
        for strategy in strategies:
            notes.append(risk_comparison(strategy))
    except Exception as error:
        notes.append(f"QuantStats unavailable ({type(error).__name__}); optional risk comparison skipped.")
    regime["method"] = "; ".join(methods)
