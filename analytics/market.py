"""Bounded public Binance data access and strict closed-candle validation."""

from __future__ import annotations

import json
import math
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


BASE_URL = "https://data-api.binance.vision"
INTERVALS = {"1h": 3_600_000, "4h": 14_400_000}
MAX_CANDLES = 3000


class MarketDataError(RuntimeError):
    """Market data unavailable or unsafe to use; never replaced with sample prices."""


@dataclass(frozen=True)
class Candle:
    time: int
    close_time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class BinanceClient:
    """Data-only host, three attempts, 12-second timeout, bounded rate-limit wait.

    No retries for bans or regional restrictions, no alternate-host rate-limit evasion.
    A long Retry-After aborts this run so the next scheduled run can try later.
    """

    def __init__(self, *, opener: Callable = urlopen, sleep: Callable = time.sleep):
        self.opener = opener
        self.sleep = sleep

    def get_json(self, path: str, params: dict) -> object:
        if path not in {"/api/v3/time", "/api/v3/klines"}:
            raise MarketDataError("Only public server-time and kline endpoints are permitted")
        url = BASE_URL + path + ("?" + urlencode(params) if params else "")
        request = Request(url, headers={"User-Agent": "CryptoIntel-X/1.0 (public-research)",
                                        "Accept": "application/json"})
        for attempt in range(3):
            try:
                with self.opener(request, timeout=12) as response:
                    raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise MarketDataError("Binance response exceeds the 2 MB safety bound")
                return json.loads(raw)
            except HTTPError as error:
                if error.code not in {429, 500, 502, 503, 504} or attempt == 2:
                    raise MarketDataError(f"Binance HTTP {error.code}; no report was produced") from error
                delay = 2 ** attempt
                retry_after = error.headers.get("Retry-After") if error.headers else None
                if retry_after:
                    try:
                        delay = max(delay, float(retry_after))
                    except ValueError:
                        try:
                            retry_at = parsedate_to_datetime(retry_after)
                            delay = max(delay, (retry_at - datetime.now(timezone.utc)).total_seconds())
                        except (TypeError, ValueError, OverflowError) as invalid:
                            raise MarketDataError("Invalid Binance Retry-After header") from invalid
                if not math.isfinite(delay) or delay > 20:
                    raise MarketDataError("Binance retry delay exceeds this run's 20-second budget") from error
                self.sleep(max(0, delay))
            except (URLError, TimeoutError, OSError) as error:
                if attempt == 2:
                    raise MarketDataError("Binance network request failed after three attempts") from error
                self.sleep(2 ** attempt)
            except (json.JSONDecodeError, UnicodeError) as error:
                raise MarketDataError("Binance returned invalid JSON") from error
        raise MarketDataError("Binance retries exhausted")


def parse_klines(rows: object, *, now_ms: int, interval_ms: int) -> list[Candle]:
    """Binance timestamps are milliseconds; current and future bars are excluded."""
    if not isinstance(rows, list):
        raise MarketDataError("Expected a Binance kline array")
    candles = []
    previous = -1
    for row in rows:
        if not isinstance(row, list) or len(row) < 12:
            raise MarketDataError("Malformed Binance OHLCV row")
        try:
            opening, closing = int(row[0]), int(row[6])
            o, h, low, close, volume = (float(row[i]) for i in (1, 2, 3, 4, 5))
        except (ValueError, TypeError, OverflowError) as error:
            raise MarketDataError("Invalid Binance candle number") from error
        if opening <= previous or opening % interval_ms or closing != opening + interval_ms - 1:
            raise MarketDataError("Duplicate, out-of-order, or misaligned Binance candle")
        previous = opening
        if not all(math.isfinite(v) for v in (o, h, low, close, volume)):
            raise MarketDataError("Nonfinite Binance candle number")
        if min(o, h, low, close) <= 0 or volume < 0 or low > min(o, close) or h < max(o, close):
            raise MarketDataError("Impossible Binance OHLCV candle")
        if closing < now_ms:
            candles.append(Candle(opening, closing, o, h, low, close, volume))
    return candles


def validate_history(candles: list[Candle], interval_ms: int) -> None:
    if not candles:
        raise MarketDataError("Binance supplied no closed candles")
    for candle in candles:
        if candle.close_time != candle.time + interval_ms - 1:
            raise MarketDataError("Candle interval does not match the requested interval")
        if not all(math.isfinite(v) for v in (candle.open, candle.high, candle.low, candle.close, candle.volume)):
            raise MarketDataError("Nonfinite market history")
        if (min(candle.open, candle.high, candle.low, candle.close) <= 0 or candle.volume < 0
                or candle.low > min(candle.open, candle.close)
                or candle.high < max(candle.open, candle.close)):
            raise MarketDataError("Impossible OHLCV history")
    for previous, current in zip(candles, candles[1:]):
        if current.time - previous.time != interval_ms:
            raise MarketDataError("Market history contains a gap, duplicate, or out-of-order candle")


def fetch_closed_klines(client: BinanceClient, symbol: str, interval: str, limit: int,
                        *, now_ms: int) -> list[Candle]:
    if not re.fullmatch(r"[A-Z0-9]{1,26}USDT", symbol):
        raise MarketDataError("Use an uppercase Binance USDT spot symbol such as BTCUSDT")
    if interval not in INTERVALS or not 1 <= limit <= MAX_CANDLES:
        raise MarketDataError("Only 1h/4h candles, at most 3000 per interval, are supported")
    interval_ms = INTERVALS[interval]
    # Binance endTime is inclusive: stop one millisecond before the open live bar.
    end_time = now_ms // interval_ms * interval_ms - 1
    collected: list[Candle] = []
    for _ in range(4):
        needed = limit - len(collected)
        if needed <= 0:
            break
        rows = client.get_json("/api/v3/klines", {"symbol": symbol, "interval": interval,
                                                 "limit": min(1000, needed), "endTime": end_time})
        page = parse_klines(rows, now_ms=now_ms, interval_ms=interval_ms)
        if not page:
            break
        if page[-1].close_time > end_time or (collected and page[-1].time >= collected[0].time):
            raise MarketDataError("Binance pagination did not advance backwards in time")
        collected = page + collected
        end_time = page[0].time - 1
    if len(collected) < limit:
        raise MarketDataError(f"Only {len(collected)} of {limit} requested closed {interval} candles available")
    candles = collected[-limit:]
    validate_history(candles, interval_ms)
    if now_ms - candles[-1].close_time > interval_ms + 60_000:
        raise MarketDataError(f"Latest closed {interval} market candle is stale")
    return candles
