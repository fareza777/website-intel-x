"""Usage: python -m analytics.run --symbol BTCUSDT --output data/analytics.json."""

from __future__ import annotations

import argparse
import math
import re
import sys
from datetime import datetime
from pathlib import Path

from .market import BinanceClient, MarketDataError, fetch_closed_klines
from .report import build_report, iso, write_report


def candle_limit(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("limit must be an integer") from error
    if not 400 <= parsed <= 3000:
        raise argparse.ArgumentTypeError("limit must be between 400 and 3000 closed 1H candles")
    return parsed


def spot_symbol(value: str) -> str:
    value = value.upper()
    if not re.fullmatch(r"[A-Z0-9]{1,26}USDT", value):
        raise argparse.ArgumentTypeError("use a USDT spot symbol such as BTCUSDT")
    return value


def as_of_time(value: str) -> int:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None or parsed.timestamp() <= 0:
            raise ValueError("explicit timezone and positive timestamp required")
        return int(parsed.timestamp() * 1000)
    except (ValueError, OverflowError, OSError) as error:
        raise argparse.ArgumentTypeError("as-of must be an ISO timestamp with timezone, e.g. 2026-10-15T00:00:00Z") from error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Cost-aware chronological spot research using real Binance data")
    parser.add_argument("--symbol", default="BTCUSDT", type=spot_symbol)
    parser.add_argument("--output", type=Path, default=Path("data/analytics.json"))
    parser.add_argument("--limit", default=1000, type=candle_limit,
                        help="closed 1H candles (400-3000; default 1000)")
    parser.add_argument("--as-of", type=as_of_time,
                        help="freeze the historical end time for a later reproducible rerun (ISO timestamp)")
    parser.add_argument("--no-optional", action="store_true",
                        help="run only the standard-library indicators and simulation")
    args = parser.parse_args(argv)
    try:
        client = BinanceClient()
        clock = client.get_json("/api/v3/time", {})
        if not isinstance(clock, dict) or not isinstance(clock.get("serverTime"), int) or clock["serverTime"] <= 0:
            raise MarketDataError("Invalid Binance server time")
        if args.as_of is not None and args.as_of > clock["serverTime"]:
            raise MarketDataError("Requested as-of time is in the future")
        now_ms = args.as_of if args.as_of is not None else clock["serverTime"]
        hourly = fetch_closed_klines(client, args.symbol, "1h", args.limit, now_ms=now_ms)
        higher_limit = max(250, math.ceil(args.limit / 4) + 100)
        higher = fetch_closed_klines(client, args.symbol, "4h", higher_limit, now_ms=now_ms)
        result = build_report(args.symbol, hourly, higher, generated_ms=clock["serverTime"], optional=not args.no_optional)
        result["notes"].append(f"Historical data cutoff: {iso(now_ms)}. Reproduce using "
                               f"--symbol {args.symbol} --limit {args.limit} --as-of {iso(now_ms)}; "
                               "upstream candle revisions can still change a later download.")
        write_report(args.output, result)
        print(f"Wrote {args.output.resolve()} from {len(hourly)} closed 1H and {len(higher)} closed 4H candles.")
        for strategy in result["strategies"]:
            print(f"{strategy['name']}: {strategy['trades']} OOS trades, "
                  f"{strategy['testReturn']:.3f}% net return, {strategy['maxDrawdown']:.3f}% max drawdown; "
                  f"sample/degradation warning={strategy['overfitWarning']}")
        return 0
    except (MarketDataError, ValueError, OSError) as error:
        print(f"Analytics failed: {error}. Existing output was preserved.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
