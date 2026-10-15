import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/types";
import { candleMetrics, chartSettingsSchema, DEFAULT_CHART_SETTINGS, buildChartStudies, readChartSettings } from "../lib/chart-studies";

function bars(count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({ time: Date.UTC(2026, 8, 1) + i * 3_600_000,
    closeTime: Date.UTC(2026, 8, 1) + (i + 1) * 3_600_000 - 1,
    open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i,
    volume: 10, quoteVolume: (100.5 + i) * 10, takerBuyVolume: 6 }));
}

describe("chart candle inspector", () => {
  it("distinguishes open-to-close, range and previous-close percentage", () => {
    const candle = { ...bars(1)[0], open: 100, high: 112, low: 98, close: 110 };
    const metrics = candleMetrics(candle, { ...candle, close: 105 });
    expect(metrics?.bodyPct).toBeCloseTo(10);
    expect(metrics?.rangePct).toBeCloseTo(14);
    expect(metrics?.previousClosePct).toBeCloseTo(100 * (110 / 105 - 1));
    expect(metrics?.buyPressurePct).toBe(60);
  });
  it("keeps doji/first-candle/zero-volume values honest", () => {
    const candle = { ...bars(1)[0], close: 100, volume: 0, takerBuyVolume: 0 };
    expect(candleMetrics(candle)?.bodyPct).toBe(0);
    expect(candleMetrics(candle)?.previousClosePct).toBeNull();
    expect(candleMetrics(candle)?.buyPressurePct).toBeNull();
    expect(candleMetrics({ ...candle, open: 0 })).toBeNull();
  });
});

describe("chart studies and saved settings", () => {
  it("validates periods, MACD ordering and bounded storage", () => {
    expect(chartSettingsSchema.safeParse({ ...DEFAULT_CHART_SETTINGS, emaFast: 0 }).success).toBe(false);
    expect(chartSettingsSchema.safeParse({ ...DEFAULT_CHART_SETTINGS, macdFast: 30, macdSlow: 20 }).success).toBe(false);
    expect(readChartSettings('{broken')).toEqual(DEFAULT_CHART_SETTINGS);
    expect(readChartSettings(JSON.stringify({ ...DEFAULT_CHART_SETTINGS, rsi: true, rsiPeriod: 9 })).rsiPeriod).toBe(9);
  });
  it("uses population standard deviation for Bollinger bands", () => {
    const data = bars(4).map((bar, i) => ({ ...bar, close: [1, 2, 3, 4][i] }));
    const study = buildChartStudies(data, { ...DEFAULT_CHART_SETTINGS, bollinger: true, bbPeriod: 4, bbMultiplier: 2 });
    expect(study.bbMiddle[2]).toBeNull();
    expect(study.bbMiddle[3]).toBe(2.5);
    expect(study.bbUpper[3]).toBeCloseTo(2.5 + 2 * Math.sqrt(1.25));
    expect(study.bbLower[3]).toBeCloseTo(2.5 - 2 * Math.sqrt(1.25));
  });
  it("resets reported quote/base VWAP at UTC midnight and excludes current bars from Donchian", () => {
    const data = bars(26);
    const study = buildChartStudies(data, { ...DEFAULT_CHART_SETTINGS, vwap: true, donchian: true, donchianPeriod: 2 });
    expect(study.vwap[23]).toBeCloseTo(data.slice(0, 24).reduce((sum, c) => sum + c.quoteVolume, 0) / 240);
    expect(study.vwap[24]).toBeCloseTo(data[24].quoteVolume / data[24].volume);
    expect(study.donchianUpper[2]).toBe(103);
    expect(study.donchianLower[2]).toBe(99);
    expect(study.donchianUpper[1]).toBeNull();
  });
  it("all study prefixes remain unchanged after extreme future data is appended", () => {
    const data = bars(220);
    const config = { ...DEFAULT_CHART_SETTINGS, sma: true, bollinger: true, vwap: true, donchian: true, rsi: true, macd: true, atr: true };
    const original = buildChartStudies(data, config);
    const extended = buildChartStudies([...data, ...bars(5).map((c, i) => ({ ...c, time: data.at(-1)!.time + (i + 1) * 3_600_000, close: 900_000 }))], config);
    for (const key of Object.keys(original) as (keyof typeof original)[]) expect(extended[key].slice(0, data.length)).toEqual(original[key]);
  });
});
