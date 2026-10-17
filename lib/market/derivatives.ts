import { inflateRawSync } from "node:zlib";

/**
 * USDⓈ-M futures positioning from Binance's public daily archives (data.binance.vision).
 * The live futures API is geo-restricted for the publisher's runners, while archives are not.
 * Archives appear roughly 7–9 hours after a UTC day ends, so a decision at time t only uses
 * days that ended at least 36 hours earlier. Training, replay and live scans share this rule.
 */
import { DERIVATIVE_KEYS, type DerivativeFeatures } from "./derivative-keys";
export { DERIVATIVE_KEYS, type DerivativeFeatures, type DerivativeKey } from "./derivative-keys";
export interface DerivativeDay { day: number; oiValue: number | null; longShort: number | null; topTrader: number | null; taker: number | null; premium: number | null }

const DAY = 86_400_000, PUBLICATION_LAG = 36 * 3_600_000;
const ARCHIVE = "https://data.binance.vision/data/futures/um/daily";

/** Latest UTC day (start time) whose archive a decision at `time` may use. */
export function latestUsableDay(time: number): number { return Math.floor((time - PUBLICATION_LAG) / DAY) * DAY; }

export const emptyDerivatives = (): DerivativeFeatures => Object.fromEntries(DERIVATIVE_KEYS.map(key => [key, null])) as DerivativeFeatures;

export function derivativeFeatures(days: DerivativeDay[] | undefined, time: number): DerivativeFeatures {
  const result = emptyDerivatives();
  if (!days?.length) return result;
  const usable = latestUsableDay(time);
  const byDay = new Map(days.map(day => [day.day, day]));
  const at = (offset: number) => byDay.get(usable - offset * DAY);
  const latest = at(0);
  if (!latest) return result;
  const ratio = (a: number | null | undefined, b: number | null | undefined) => a && b && a > 0 && b > 0 ? Math.log(a / b) : null;
  const clip = (value: number | null, limit: number) => value === null || !Number.isFinite(value) ? null : Math.max(-limit, Math.min(limit, value));
  result.oiChange1d = clip(ratio(latest.oiValue, at(1)?.oiValue), 2);
  result.oiChange7d = clip(ratio(latest.oiValue, at(7)?.oiValue), 3);
  result.longShortRatio = clip(latest.longShort && latest.longShort > 0 ? Math.log(latest.longShort) : null, 3);
  result.topTraderRatio = clip(latest.topTrader && latest.topTrader > 0 ? Math.log(latest.topTrader) : null, 3);
  result.takerRatio = clip(latest.taker && latest.taker > 0 ? Math.log(latest.taker) : null, 2);
  const premiums = [0, 1, 2].map(offset => at(offset)?.premium).filter((value): value is number => value != null);
  // Premium index in basis points; its average drives the perpetual funding rate.
  result.premium3d = premiums.length ? clip(premiums.reduce((s, v) => s + v, 0) / premiums.length * 10_000, 100) : null;
  return result;
}

/** Extract the single CSV member of a Binance archive using its central directory. */
export function unzipSingle(buffer: Uint8Array): string {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("Invalid archive: no central directory");
  const central = view.getUint32(end + 16, true);
  if (view.getUint32(central, true) !== 0x02014b50) throw new Error("Invalid archive directory");
  const method = view.getUint16(central + 10, true), size = view.getUint32(central + 20, true), local = view.getUint32(central + 42, true);
  if (view.getUint32(local, true) !== 0x04034b50) throw new Error("Invalid archive member");
  const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
  const data = buffer.subarray(start, start + size);
  return (method === 0 ? Buffer.from(data) : inflateRawSync(data)).toString("utf8");
}

const numeric = (value: string | undefined) => { const n = Number(value); return value !== undefined && value !== "" && Number.isFinite(n) ? n : null; };
const mean = (values: (number | null)[]) => { const finite = values.filter((v): v is number => v !== null); return finite.length ? finite.reduce((s, v) => s + v, 0) / finite.length : null; };

export function parseMetrics(csv: string): Omit<DerivativeDay, "day" | "premium"> {
  const rows = csv.trim().split(/\r?\n/).map(line => line.split(","));
  const header = rows[0]?.[0] === "create_time" ? rows.shift()! : ["create_time", "symbol", "sum_open_interest", "sum_open_interest_value", "count_toptrader_long_short_ratio", "sum_toptrader_long_short_ratio", "count_long_short_ratio", "sum_taker_long_short_vol_ratio"];
  const column = (name: string) => header.indexOf(name);
  const oi = column("sum_open_interest_value"), top = column("sum_toptrader_long_short_ratio"), ls = column("count_long_short_ratio"), taker = column("sum_taker_long_short_vol_ratio");
  const values = (index: number) => rows.map(row => numeric(row[index]));
  const oiValues = values(oi).filter((v): v is number => v !== null && v > 0);
  return { oiValue: oiValues.at(-1) ?? null, topTrader: mean(values(top)), longShort: mean(values(ls)), taker: mean(values(taker)) };
}

export function parsePremium(csv: string): number | null {
  const rows = csv.trim().split(/\r?\n/).map(line => line.split(",")).filter(row => numeric(row[0]) !== null);
  return mean(rows.map(row => numeric(row[4])));
}

export type ArchiveFetcher = (url: string) => Promise<Uint8Array | null>;
export const archiveFetcher: ArchiveFetcher = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (response.status === 404) { await response.body?.cancel(); return null; }
  if (!response.ok) throw new Error(`Archive request failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

const iso = (day: number) => new Date(day).toISOString().slice(0, 10);

/** Download metrics and premium archives for [firstDay, lastDay]. Missing days stay absent, never invented. */
export async function fetchDerivativeDays(symbol: string, firstDay: number, lastDay: number, options: { fetcher?: ArchiveFetcher; concurrency?: number } = {}): Promise<DerivativeDay[]> {
  if (!/^[A-Z0-9]{1,26}USDT$/.test(symbol)) throw new Error("Invalid derivative symbol");
  const fetcher = options.fetcher ?? archiveFetcher;
  const days: number[] = [];
  for (let day = firstDay; day <= lastDay; day += DAY) days.push(day);
  const result: DerivativeDay[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? 8) }, async () => {
    while (cursor < days.length) {
      const day = days[cursor++];
      const [metrics, premium] = await Promise.all([
        fetcher(`${ARCHIVE}/metrics/${symbol}/${symbol}-metrics-${iso(day)}.zip`).catch(() => null),
        fetcher(`${ARCHIVE}/premiumIndexKlines/${symbol}/1h/${symbol}-1h-${iso(day)}.zip`).catch(() => null),
      ]);
      if (!metrics && !premium) continue;
      try {
        result.push({ day, ...(metrics ? parseMetrics(unzipSingle(metrics)) : { oiValue: null, topTrader: null, longShort: null, taker: null }), premium: premium ? parsePremium(unzipSingle(premium)) : null });
      } catch { /* A corrupt archive is treated as missing rather than guessed. */ }
    }
  }));
  return result.sort((a, b) => a.day - b.day);
}

/** Days a decision at `time` needs: the usable day and the seven before it. */
export function requiredDays(time: number): [number, number] { const last = latestUsableDay(time); return [last - 7 * DAY, last]; }
