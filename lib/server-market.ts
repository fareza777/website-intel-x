import { scanMarket } from "./market/scanner";
import type { MarketSnapshot } from "./types";
const cache = new Map<string, { expires: number; result: Promise<MarketSnapshot> }>();
export function cachedScan(symbols?: string[], limit = 30): Promise<MarketSnapshot> {
  const key = symbols ? [...symbols].sort().join(",") : `top:${limit}`;
  const current = cache.get(key);
  if (current && current.expires > Date.now()) return current.result;
  if (cache.size > 20) cache.clear();
  const result = scanMarket(symbols ? { symbols } : { limit });
  cache.set(key, { expires: Date.now() + 120_000, result });
  result.catch(() => cache.delete(key));
  return result;
}
