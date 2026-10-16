export interface MeasurementPoint { price: number; time: number }
export function measurementPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  const label = magnitude > 0 && (magnitude < 1e-8 || magnitude >= 1e12) ? Number(magnitude.toPrecision(10)).toString() : magnitude.toLocaleString("en-US", { maximumSignificantDigits: 10 });
  return `${value < 0 ? "−" : ""}$${label}`;
}
export function measurePriceMove(start: MeasurementPoint, end: MeasurementPoint, intervalMs: number): { priceChange: number; percentChange: number; bars: number; durationMs: number } | null {
  if (![start.price, end.price, start.time, end.time, intervalMs].every(Number.isFinite) || start.price <= 0 || end.price <= 0 || intervalMs <= 0) return null;
  const durationMs = Math.abs(end.time - start.time);
  const priceChange = end.price - start.price;
  const percentChange = priceChange / start.price * 100;
  if (![priceChange, percentChange, durationMs].every(Number.isFinite)) return null;
  return { priceChange, percentChange, durationMs, bars: Math.round(durationMs / intervalMs) };
}
