import { NextResponse } from "next/server";
import { z } from "zod";
import { getCandles } from "@/lib/market/binance";
import { symbolSchema } from "@/lib/validation";
const schema = z.object({ symbol: symbolSchema, interval: z.enum(["15m", "1h", "4h", "1d"]).default("1h"), limit: z.coerce.number().int().min(50).max(1000).default(300), startTime: z.coerce.number().int().min(0).optional() });
export async function GET(request: Request) {
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid symbol, interval, or candle limit." }, { status: 400 });
  try {
    const { symbol, interval, limit, startTime } = parsed.data;
    return NextResponse.json({ symbol, interval, candles: await getCandles(symbol, interval, limit, startTime), source: "Binance public spot · closed candles" }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=60" } });
  } catch { return NextResponse.json({ error: "Binance market data is currently unavailable. No substitute prices are shown." }, { status: 503 }); }
}
