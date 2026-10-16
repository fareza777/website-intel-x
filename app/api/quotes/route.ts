import { NextResponse } from "next/server";
import { getSpotPrices } from "@/lib/market/binance";
import { symbolSchema } from "@/lib/validation";
export async function GET(request: Request) {
  const value = new URL(request.url).searchParams.get("symbols") || "";
  const symbols = [...new Set(value.split(",").filter(Boolean))];
  if (value.length > 2000 || !symbols.length || symbols.length > 50 || symbols.some(symbol => !symbolSchema.safeParse(symbol).success)) return NextResponse.json({ error: "Provide 1–50 valid USDT spot symbols." }, { status: 400 });
  try { return NextResponse.json({ quotes: await getSpotPrices(symbols), source: "Binance public spot · rolling 24h ticker", refreshSeconds: 30 }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=15, must-revalidate" } }); }
  catch { return NextResponse.json({ error: "Fresh spot quotes are unavailable. Previous marks must not be treated as current." }, { status: 503 }); }
}
