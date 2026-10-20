import { NextResponse } from "next/server";
import { z } from "zod";
import { getCandles } from "@/lib/market/binance";
import { symbolSchema } from "@/lib/validation";
import { candleCacheSeconds } from "@/lib/live-market";
const schema = z.object({ symbol: symbolSchema, interval: z.enum(["15m", "1h", "4h", "1d"]).default("1h"), limit: z.coerce.number().int().min(50).max(1000).default(300), startTime: z.coerce.number().int().min(0).optional() });
export async function GET(request: Request) {
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid symbol, interval, or candle limit." }, { status: 400 });
  try {
    const { symbol, interval, limit, startTime } = parsed.data;
    const candles = await getCandles(symbol, interval, limit, startTime);
    // Chart history is identical for every viewer until the next candle closes; paper replays (startTime) keep a short cache.
    const cache = startTime === undefined ? `public, s-maxage=${candleCacheSeconds(interval, candles.at(-1)?.closeTime ?? null, Date.now())}` : "public, s-maxage=60, stale-while-revalidate=60";
    return NextResponse.json({ symbol, interval, candles, source: "Binance public spot · closed candles" }, { headers: { "Cache-Control": cache } });
  } catch { return NextResponse.json({ error: "Binance market data is currently unavailable. No substitute prices are shown." }, { status: 503 }); }
}
