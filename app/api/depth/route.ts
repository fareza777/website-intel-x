import { NextResponse } from "next/server";
import { getOrderBook } from "@/lib/market/binance";
import { symbolSchema } from "@/lib/validation";
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol") || "BTCUSDT";
  if (!symbolSchema.safeParse(symbol).success) return NextResponse.json({ error: "Invalid symbol." }, { status: 400 });
  try { return NextResponse.json(await getOrderBook(symbol), { headers: { "Cache-Control": "public, s-maxage=15" } }); }
  catch { return NextResponse.json({ error: "Order book is unavailable." }, { status: 503 }); }
}
