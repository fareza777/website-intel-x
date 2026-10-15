"""Small deterministic fixtures test mechanics, never supply production market data."""

import io
import json
import math
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from urllib.error import HTTPError


class AnalyticsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from analytics import core, market, report
        except ImportError:
            cls.modules = None
        else:
            cls.modules = core, market, report

    def api(self):
        self.assertIsNotNone(self.modules, "The analytics implementation is not available yet")
        return self.modules

    def candle(self, index, close=100, *, open_price=None, high=None, low=None, interval=3_600_000):
        _, market, _ = self.api()
        opening = close if open_price is None else open_price
        return market.Candle(index * interval, (index + 1) * interval - 1,
                             opening, max(opening, close) + 1 if high is None else high,
                             min(opening, close) - 1 if low is None else low, close, 100)

    def bars(self, count=600, *, interval=3_600_000):
        return [self.candle(i, 100 + i * .03 + math.sin(i / 7) * 3, interval=interval)
                for i in range(count)]

    def decisions(self, size, enter_at=0, exit_at=None, stop=90, target=120):
        core, _, _ = self.api()
        result = [core.Decision(False, False, stop, target) for _ in range(size)]
        result[enter_at] = core.Decision(True, False, stop, target)
        if exit_at is not None:
            result[exit_at] = core.Decision(False, True, stop, target)
        return result

    def test_indicators_have_hand_checked_seed_and_are_prefix_invariant(self):
        core, _, _ = self.api()
        self.assertEqual(core.ema([1, 2, 3, 4, 5], 3), [None, None, 2, 3, 4])
        self.assertEqual(core.rsi([1, 2, 3, 4, 5], 3), [None, None, None, 100, 100])
        self.assertEqual(core.rsi([5, 5, 5, 5, 5], 3), [None, None, None, 50, 50])
        prices = [c.close for c in self.bars(120)]
        for function, period in ((core.ema, 21), (core.rsi, 14)):
            self.assertEqual(function(prices[:75], period), function(prices, period)[:75])

    def test_atr_uses_previous_close_for_gap_and_wilder_seed(self):
        core, _, _ = self.api()
        bars = [self.candle(0, 100, high=101, low=99),
                self.candle(1, 110, high=111, low=109),
                self.candle(2, 110, high=112, low=108),
                self.candle(3, 110, high=111, low=109)]
        self.assertEqual(core.atr(bars, 3), [None, None, None, 17 / 3])

    def test_only_closed_candles_survive_exchange_shape_parser(self):
        _, market, _ = self.api()
        rows = [[i * 3600000, "100", "102", "99", "101", "1", (i+1)*3600000-1,
                 "100", 10, "0.5", "50", "0"] for i in range(3)]
        candles = market.parse_klines(rows, now_ms=7_200_000, interval_ms=3_600_000)
        self.assertEqual([c.time for c in candles], [0, 3_600_000])

    def test_parser_rejects_invalid_prices_and_out_of_order_history(self):
        _, market, _ = self.api()
        row = [0, "100", "102", "99", "101", "1", 3599999, "100", 10, "0.5", "50", "0"]
        for invalid in ([row, row], [row[:1] + ["nan"] + row[2:]],
                        [row[:2] + ["98"] + row[3:]]):
            with self.assertRaises(market.MarketDataError):
                market.parse_klines(invalid, now_ms=4_000_000, interval_ms=3_600_000)

    def test_four_hour_feature_never_uses_a_candle_before_its_close(self):
        core, _, _ = self.api()
        hourly = self.bars(220)
        higher = self.bars(55, interval=14_400_000)
        changed = [replace(c, close=c.close + 50, high=c.high + 50) if i >= 50 else c
                   for i, c in enumerate(higher)]
        original = core.build_decisions(hourly, higher, "momentum")
        modified = core.build_decisions(hourly, changed, "momentum")
        self.assertEqual(original[:203], modified[:203])

    def test_future_price_changes_cannot_rewrite_past_decisions(self):
        core, _, _ = self.api()
        hourly = self.bars()
        higher = self.bars(200, interval=14_400_000)
        prefix = core.build_decisions(hourly[:350], higher[:87], "pullback")
        full = core.build_decisions(hourly, higher, "pullback")
        self.assertEqual(prefix[:348], full[:348])

    def test_signal_at_close_enters_at_next_open_with_adverse_slippage(self):
        core, _, _ = self.api()
        bars = [self.candle(0), self.candle(1, 105), self.candle(2, 105)]
        result = core.simulate(bars, self.decisions(3), 1, 3)
        self.assertEqual(len(result.trades), 1)
        trade = result.trades[0]
        self.assertEqual(trade.entry_index, 1)
        self.assertEqual(trade.decision_time, bars[0].close_time)
        self.assertAlmostEqual(trade.entry_fill, 105.0525)
        self.assertEqual(trade.exit_index, 2)

    def test_round_trip_conserves_cash_and_charges_both_sides(self):
        core, _, _ = self.api()
        bars = [self.candle(i) for i in range(4)]
        result = core.simulate(bars, self.decisions(4, exit_at=1), 1, 4)
        # 1000 / (100 * 1.0005 * 1.001) units; sell at 100 * .9995 less .1% fee.
        expected_cash = 1000 * .9995 * .999 / (1.0005 * 1.001)
        self.assertAlmostEqual(result.final_equity, expected_cash)
        self.assertAlmostEqual(result.trades[0].net_return, expected_cash / 1000 - 1)
        self.assertLess(result.final_equity, 1000)

    def test_known_opening_target_precedes_a_later_intrabar_stop(self):
        core, _, _ = self.api()
        bars = [self.candle(0), self.candle(1),
                self.candle(2, 99, open_price=121, high=125, low=94), self.candle(3)]
        result = core.simulate(bars, self.decisions(4, stop=95, target=120), 1, 4)
        self.assertEqual(result.trades[0].reason, "TARGET GAP")
        self.assertAlmostEqual(result.trades[0].exit_fill, 119.94)
        self.assertGreater(result.trades[0].net_return, .19)

    def test_gap_through_stop_uses_lower_open_and_adverse_slippage(self):
        core, _, _ = self.api()
        bars = [self.candle(0), self.candle(1), self.candle(2, 80), self.candle(3, 80)]
        result = core.simulate(bars, self.decisions(4), 1, 4)
        self.assertEqual(result.trades[0].reason, "STOP GAP")
        self.assertAlmostEqual(result.trades[0].exit_fill, 79.96)

    def test_ambiguous_stop_and_target_resolves_stop_first(self):
        core, _, _ = self.api()
        bars = [self.candle(0), self.candle(1),
                self.candle(2, 100, low=85, high=125), self.candle(3)]
        result = core.simulate(bars, self.decisions(4), 1, 4)
        self.assertEqual(result.trades[0].reason, "STOP")
        self.assertAlmostEqual(result.trades[0].exit_fill, 89.955)

    def test_entry_bar_does_not_receive_an_optimistic_target_fill(self):
        core, _, _ = self.api()
        bars = [self.candle(0), self.candle(1, high=125), self.candle(2), self.candle(3)]
        result = core.simulate(bars, self.decisions(4), 1, 4)
        self.assertEqual(result.trades[0].reason, "FOLD END")
        self.assertEqual(result.trades[0].exit_index, 3)

    def test_stop_still_protects_entry_bar(self):
        core, _, _ = self.api()
        bars = [self.candle(0), self.candle(1, low=85, high=125), self.candle(2)]
        result = core.simulate(bars, self.decisions(3), 1, 3)
        self.assertEqual(result.trades[0].reason, "STOP")
        self.assertEqual(result.trades[0].exit_index, 1)

    def test_overlapping_buy_signals_cannot_create_overlapping_positions(self):
        core, _, _ = self.api()
        bars = [self.candle(i) for i in range(12)]
        decisions = [core.Decision(True, False, 90, 120) for _ in bars]
        result = core.simulate(bars, decisions, 1, 12, max_holding=3)
        self.assertGreater(len(result.trades), 1)
        for earlier, later in zip(result.trades, result.trades[1:]):
            self.assertLess(earlier.exit_index, later.entry_index)

    def test_drawdown_uses_equity_troughs_not_only_closed_trades(self):
        core, _, _ = self.api()
        self.assertAlmostEqual(core.max_drawdown([1000, 1100, 880, 1050]), 20)
        self.assertEqual(core.max_drawdown([1000, 1010]), 0)

    def test_no_trades_and_no_losses_use_null_undefined_statistics(self):
        core, _, _ = self.api()
        empty = core.summarize([], [1000, 1000])
        self.assertEqual(empty["trades"], 0)
        self.assertIsNone(empty["winRate"])
        self.assertIsNone(empty["profitFactor"])
        self.assertIsNone(empty["expectancy"])
        self.assertEqual(empty["totalReturn"], 0)
        bars = [self.candle(0), self.candle(1), self.candle(2, 110), self.candle(3, 110)]
        result = core.simulate(bars, self.decisions(4, exit_at=1), 1, 4)
        winner = core.summarize(result.trades, [1000, result.final_equity])
        self.assertEqual(winner["winRate"], 100)
        self.assertIsNone(winner["profitFactor"])

    def test_walk_forward_has_expanding_train_and_disjoint_later_test_folds(self):
        core, _, _ = self.api()
        folds = core.walk_forward_folds(1000, warmup=200, folds=3)
        self.assertEqual(len(folds), 3)
        seen = set()
        for train_start, train_end, test_start, test_end in folds:
            self.assertEqual(train_start, 200)
            self.assertEqual(train_end, test_start)
            self.assertGreater(test_end, test_start)
            test_indices = set(range(test_start, test_end))
            self.assertFalse(seen & test_indices)
            seen |= test_indices
        self.assertEqual(folds[-1][-1], 1000)

    def test_report_has_exact_types_finite_metrics_and_low_sample_warning(self):
        _, _, report = self.api()
        result = report.build_report("BTCUSDT", self.bars(), self.bars(200, interval=14_400_000),
                                     generated_ms=2_160_000_000, optional=False)
        self.assertEqual(set(result), {"generatedAt", "symbol", "dataSource", "start", "end",
                                       "strategies", "notes", "regime"})
        self.assertEqual(len(result["strategies"]), 2)
        expected = {"name", "trades", "winRate", "profitFactor", "expectancy", "maxDrawdown",
                    "totalReturn", "trainReturn", "testReturn", "overfitWarning", "equity"}
        for strategy in result["strategies"]:
            self.assertEqual(set(strategy), expected)
            self.assertIsInstance(strategy["overfitWarning"], bool)
            self.assertTrue(strategy["overfitWarning"])
            self.assertEqual(strategy["totalReturn"], strategy["testReturn"])
            self.assertGreater(len(strategy["equity"]), 10)
            self.assertEqual(set(strategy["equity"][0]), {"time", "value"})
        json.dumps(result, allow_nan=False)
        self.assertEqual(set(result["regime"]), {"current", "changePoints", "driftDetected", "method"})
        self.assertTrue(any("low sample" in note.lower() for note in result["notes"]))

    def test_report_rejects_gaps_instead_of_forward_filling_fake_candles(self):
        _, market, report = self.api()
        bars = self.bars()
        with self.assertRaises(market.MarketDataError):
            report.build_report("BTCUSDT", bars[:300] + bars[301:],
                                self.bars(200, interval=14_400_000), optional=False)

    def test_http_retry_after_is_obeyed_with_bounded_attempts(self):
        _, market, _ = self.api()
        calls, sleeps = [], []
        def opening(request, timeout):
            calls.append(request.full_url)
            if len(calls) < 3:
                raise HTTPError(request.full_url, 429, "rate limited", {"Retry-After": "2"}, None)
            return io.BytesIO(b'{"serverTime": 12345}')
        client = market.BinanceClient(opener=opening, sleep=sleeps.append)
        self.assertEqual(client.get_json("/api/v3/time", {}), {"serverTime": 12345})
        self.assertEqual(len(calls), 3)
        self.assertEqual(sleeps, [2, 2])

    def test_http_rate_limit_beyond_retry_budget_fails_without_evasion(self):
        _, market, _ = self.api()
        calls, sleeps = [], []
        def opening(request, timeout):
            calls.append(request.full_url)
            raise HTTPError(request.full_url, 429, "rate limited", {"Retry-After": "120"}, None)
        client = market.BinanceClient(opener=opening, sleep=sleeps.append)
        with self.assertRaises(market.MarketDataError):
            client.get_json("/api/v3/time", {})
        self.assertEqual(len(calls), 1)
        self.assertEqual(sleeps, [])

    def test_fetch_paginates_by_exchange_timestamp_and_excludes_live_bar(self):
        _, market, _ = self.api()
        requests = []
        rows = [[i * 3600000, "100", "102", "99", "101", "1", (i+1)*3600000-1,
                 "100", 10, "0.5", "50", "0"] for i in range(1101)]
        class Client:
            def get_json(self, path, params):
                self_path = path
                if self_path == "/api/v3/time":
                    return {"serverTime": 1100 * 3600000 + 500}
                requests.append(dict(params))
                end = params["endTime"]
                return [r for r in rows if r[0] <= end][-params["limit"]:]
        candles = market.fetch_closed_klines(Client(), "BTCUSDT", "1h", 1100,
                                              now_ms=1100 * 3600000 + 500)
        self.assertEqual(len(candles), 1100)
        self.assertEqual(candles[0].time, 0)
        self.assertEqual(candles[-1].time, 1099 * 3600000)
        self.assertLessEqual(len(requests), 3)
        self.assertLess(requests[1]["endTime"], requests[0]["endTime"])

    def test_atomic_output_is_valid_json_and_failure_preserves_existing_report(self):
        _, _, report = self.api()
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "analytics.json"
            report.write_report(destination, {"valid": 1})
            with self.assertRaises(ValueError):
                report.write_report(destination, {"invalid": float("nan")})
            self.assertEqual(json.loads(destination.read_text()), {"valid": 1})


if __name__ == "__main__":
    unittest.main()
