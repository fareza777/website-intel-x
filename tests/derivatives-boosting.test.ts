import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { derivativeFeatures, fetchDerivativeDays, latestUsableDay, parseMetrics, parsePremium, unzipSingle } from "../lib/market/derivatives";
import { boostedProbability, trainBoosted } from "../lib/market/boosting";
import { auc } from "../lib/market/model";

/** Minimal single-member zip, laid out like Binance archives (deflate, central directory). */
function zip(name: string, text: string): Uint8Array {
  const data = deflateRawSync(Buffer.from(text)), file = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(text.length, 22); local.writeUInt16LE(file.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(text.length, 24); central.writeUInt16LE(file.length, 28); central.writeUInt32LE(0, 42);
  const offset = local.length + file.length + data.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + file.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([local, file, data, central, file, end]));
}
const DAY = 86_400_000;
const metrics = (oi: number) => `create_time,symbol,sum_open_interest,sum_open_interest_value,count_toptrader_long_short_ratio,sum_toptrader_long_short_ratio,count_long_short_ratio,sum_taker_long_short_vol_ratio
2026-10-15 00:05:00,BTCUSDT,1,${oi - 10},1.8,1.5,2.0,0.9
2026-10-15 23:55:00,BTCUSDT,1,${oi},1.9,1.6,2.2,1.1`;

describe("futures archives", () => {
  it("unzips and parses Binance metrics and premium files", () => {
    expect(unzipSingle(zip("a.csv", "hello,world"))).toBe("hello,world");
    expect(parseMetrics(metrics(500))).toEqual({ oiValue: 500, topTrader: 1.55, longShort: 2.1, taker: 1 });
    expect(parsePremium("open_time,open,high,low,close\n1,0,0,0,0.0002\n2,0,0,0,0.0004")).toBeCloseTo(.0003);
  });
  it("uses only archives published at least 36 hours before the decision", () => {
    const t = Date.UTC(2026, 9, 17, 1, 12);
    expect(new Date(latestUsableDay(t)).toISOString()).toBe("2026-10-15T00:00:00.000Z");
    const usable = latestUsableDay(t);
    const days = Array.from({ length: 9 }, (_, i) => ({ day: usable - (8 - i) * DAY + (i === 8 ? 0 : 0), oiValue: 100 + i * 10, longShort: 2, topTrader: 1.5, taker: 1.1, premium: .0002 }));
    const future = { day: usable + DAY, oiValue: 1e9, longShort: 99, topTrader: 99, taker: 99, premium: 1 };
    const features = derivativeFeatures([...days, future], t);
    expect(features.oiChange1d).toBeCloseTo(Math.log(180 / 170));
    expect(features.oiChange7d).toBeCloseTo(Math.log(180 / 110));
    expect(features.premium3d).toBeCloseTo(2);
    expect(features.longShortRatio).toBeCloseTo(Math.log(2));
    expect(derivativeFeatures(undefined, t).oiChange1d).toBeNull();
  });
  it("downloads day ranges and treats missing archives as absent", async () => {
    const urls: string[] = [];
    const days = await fetchDerivativeDays("BTCUSDT", Date.UTC(2026, 9, 14), Date.UTC(2026, 9, 15), { fetcher: async url => {
      urls.push(url);
      if (url.includes("2026-10-14")) return null;
      return url.includes("metrics") ? zip("m.csv", metrics(700)) : zip("p.csv", "1,0,0,0,0.0001");
    } });
    expect(urls).toHaveLength(4);
    expect(days).toEqual([{ day: Date.UTC(2026, 9, 15), oiValue: 700, topTrader: 1.55, longShort: 2.1, taker: 1, premium: .0001 }]);
  });
});

describe("gradient boosting", () => {
  it("learns an interaction a linear model cannot express", () => {
    let seed = 5; const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const rows = Array.from({ length: 1500 }, () => [random() * 2 - 1, random() * 2 - 1, random()]);
    const labels = rows.map(([a, b]) => random() < (a * b > 0 ? .8 : .2) ? 1 : 0);
    const model = trainBoosted(rows.slice(0, 1000), labels.slice(0, 1000), { rounds: 80 });
    const test = rows.slice(1000), scores = test.map(row => boostedProbability(model, row));
    expect(auc(scores, labels.slice(1000))!).toBeGreaterThan(.7);
    expect(JSON.parse(JSON.stringify(model))).toEqual(model);
  });
});
