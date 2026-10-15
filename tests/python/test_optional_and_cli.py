import contextlib
import importlib.util
import io
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


class OptionalAndCliTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from analytics import optional, run
        except ImportError:
            cls.modules = None
        else:
            cls.modules = optional, run

    def api(self):
        self.assertIsNotNone(self.modules, "Optional and CLI analytics are not implemented yet")
        return self.modules

    def bars(self, count=600, interval=3600000):
        from analytics.market import Candle
        return [Candle(i*interval, (i+1)*interval-1, 100 + i*.02 + math.sin(i/7),
                       102+i*.02+math.sin(i/7), 98+i*.02+math.sin(i/7),
                       100+i*.02+math.sin(i/7), 100) for i in range(count)]

    def test_online_drift_consumes_one_return_at_a_time_without_full_sample_scaling(self):
        optional, _ = self.api()
        class Detector:
            def __init__(self):
                self.values = []
                self.drift_detected = False
            def update(self, value):
                self.values.append(value)
                self.drift_detected = len(self.values) == 2
        original = Detector()
        detected, indices = optional.online_drift([.01, -.02, .03], original)
        changed_future = Detector()
        optional.online_drift([.01, -.02, .50], changed_future)
        self.assertTrue(detected)
        self.assertEqual(indices, [1])
        self.assertEqual(original.values[:2], changed_future.values[:2])
        self.assertAlmostEqual(original.values[0], .2)
        self.assertAlmostEqual(original.values[1], .4)
        self.assertEqual(changed_future.values[-1], 1)

    def test_missing_optional_libraries_preserve_report_and_explicitly_mark_unavailable(self):
        optional, _ = self.api()
        regime = {"current": "SIDEWAYS", "changePoints": [], "driftDetected": False, "method": "EMA"}
        notes = []
        with patch.object(optional, "load_module", side_effect=ImportError("not installed")):
            optional.enrich(self.bars(), [], regime, notes)
        self.assertEqual(regime["changePoints"], [])
        self.assertFalse(regime["driftDetected"])
        self.assertEqual(len(notes), 4)
        self.assertTrue(all("unavailable" in note.lower() for note in notes))
        self.assertIn("unavailable", regime["method"].lower())

    def test_cli_failed_download_does_not_replace_existing_output(self):
        _, run = self.api()
        from analytics.market import MarketDataError
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "report.json"
            output.write_text('{"existing":true}')
            with patch.object(run.BinanceClient, "get_json", side_effect=MarketDataError("offline")):
                with contextlib.redirect_stderr(io.StringIO()):
                    status = run.main(["--symbol", "BTCUSDT", "--output", str(output)])
            self.assertNotEqual(status, 0)
            self.assertEqual(json.loads(output.read_text()), {"existing": True})

    def test_cli_uses_exchange_time_closed_intervals_and_serializes_actual_report(self):
        _, run = self.api()
        requested = []
        hourly, higher = self.bars(), self.bars(250, 14400000)
        def fetch(client, symbol, interval, limit, *, now_ms):
            requested.append((symbol, interval, limit, now_ms))
            return hourly if interval == "1h" else higher
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "report.json"
            with patch.object(run.BinanceClient, "get_json", return_value={"serverTime": 2160000000}):
                with patch.object(run, "fetch_closed_klines", side_effect=fetch):
                    with contextlib.redirect_stdout(io.StringIO()):
                        status = run.main(["--symbol", "BTCUSDT", "--output", str(output),
                                           "--limit", "600", "--no-optional"])
            self.assertEqual(status, 0)
            self.assertEqual({entry[1] for entry in requested}, {"1h", "4h"})
            self.assertTrue(all(entry[3] == 2160000000 for entry in requested))
            result = json.loads(output.read_text())
            self.assertEqual(result["symbol"], "BTCUSDT")
            self.assertEqual(len(result["strategies"]), 2)
            self.assertTrue(result["end"].endswith("Z"))

    def test_cli_candle_count_budget_rejects_excess_before_network_access(self):
        _, run = self.api()
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as result:
                run.main(["--limit", "50000"])
        self.assertEqual(result.exception.code, 2)

    def test_cli_as_of_freezes_closed_history_for_a_reproducible_later_rerun(self):
        _, run = self.api()
        requested = []
        def fetch(client, symbol, interval, limit, *, now_ms):
            requested.append(now_ms)
            return self.bars() if interval == "1h" else self.bars(250, 14400000)
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "report.json"
            with patch.object(run.BinanceClient, "get_json", return_value={"serverTime": 3000000000}):
                with patch.object(run, "fetch_closed_klines", side_effect=fetch):
                    with contextlib.redirect_stdout(io.StringIO()):
                        status = run.main(["--as-of", "1970-01-26T00:00:00Z", "--no-optional",
                                           "--output", str(destination)])
            self.assertEqual(status, 0)
            self.assertEqual(requested, [2160000000, 2160000000])
            result = json.loads(destination.read_text())
            self.assertTrue(any("--as-of 1970-01-26T00:00:00.000Z" in note for note in result["notes"]))

    def test_cli_as_of_future_is_rejected_instead_of_simulating_unknown_prices(self):
        _, run = self.api()
        with patch.object(run.BinanceClient, "get_json", return_value={"serverTime": 1000}):
            with contextlib.redirect_stderr(io.StringIO()):
                status = run.main(["--as-of", "2026-10-15T00:00:00Z"])
        self.assertNotEqual(status, 0)

    @unittest.skipUnless(importlib.util.find_spec("pandas_ta_classic"), "optional pandas-ta-classic not installed")
    def test_independent_reference_check_compares_native_ema_and_rsi(self):
        optional, _ = self.api()
        result = optional.check_indicators(self.bars(1000))
        self.assertIn("EMA", result)
        self.assertIn("RSI", result)
        self.assertIn("PASS", result)

    @unittest.skipUnless(importlib.util.find_spec("ruptures"), "optional ruptures not installed")
    def test_real_ruptures_adapter_returns_only_internal_closed_bar_timestamps(self):
        optional, _ = self.api()
        bars = self.bars()
        points = optional.retrospective_points(bars)
        allowed = {c.close_time for c in bars[:-1]}
        self.assertTrue(all(time in allowed for time in points))
        self.assertLessEqual(len(points), 20)

    @unittest.skipUnless(importlib.util.find_spec("river"), "optional River not installed")
    def test_real_river_adwin_detects_chronological_volatility_shift(self):
        optional, _ = self.api()
        from river.drift import ADWIN
        detected, indices = optional.online_drift([.0001] * 500 + [.05] * 500, ADWIN())
        self.assertTrue(detected)
        self.assertTrue(all(499 <= index < 1000 for index in indices))

    @unittest.skipUnless(importlib.util.find_spec("quantstats"), "optional QuantStats not installed")
    def test_real_quantstats_risk_adapter_never_downloads_a_benchmark(self):
        optional, _ = self.api()
        equity = [{"time": f"2026-01-0{i+1}T00:00:00.000Z", "value": value}
                  for i, value in enumerate([1000, 1100, 880, 1050])]
        result = optional.risk_comparison({"name": "test", "equity": equity})
        self.assertIn("20.000", result)
        self.assertIn("365", result)


if __name__ == "__main__":
    unittest.main()
