import type { MarketSetup, QualificationCheck, Timeframe } from "./types";

export function riskLesson(positionLossPct: number, capital: number, accountRiskPct: number) {
  if (![positionLossPct, capital, accountRiskPct].every(Number.isFinite) || positionLossPct <= 0 || positionLossPct >= 100 || capital <= 0 || accountRiskPct <= 0 || accountRiskPct > 5) return null;
  const accountBudget = capital * accountRiskPct / 100;
  return { accountBudget, lossOn100: positionLossPct, approximateDebit: Math.min(capital, accountBudget / (positionLossPct / 100)) };
}
export function positionLoss(setup: MarketSetup): number | null {
  const loss = setup.riskReview?.costedLossPct ?? setup.plan?.riskPct;
  if (loss != null && Number.isFinite(loss)) return loss;
  const text = setup.qualification?.find(check => check.id === "risk")?.detail ?? setup.reasons?.join(" ") ?? "";
  const match = /(?:stop risk|Planned loss)\s+(\d+(?:\.\d+)?)%/i.exec(text);
  return match ? Number(match[1]) : null;
}
const labels: Record<string, [string, string]> = {
  freshness: ["Data sudah lengkap saat scan", "Analisis memakai candle yang sudah ditutup, dengan batas umur data sesuai timeframe."],
  liquidity: ["Pasar cukup likuid", "Volume harian harus cukup besar dan volume candle terbaru tidak terlalu sepi."],
  trend_safety: ["Tren pendukung tidak turun", "Strategi spot long menghindari arah turun pada timeframe yang dipakai untuk konfirmasi."],
  volatility: ["Pergerakan masih terkendali", "ATR mengukur rata-rata jangkauan harga. ATR terlalu besar membuat rencana entry dan stop lebih sulit dipertahankan."],
  extension: ["Harga belum terlalu jauh naik", "Harga yang terlalu jauh di atas EMA atau RSI terlalu tinggi lebih rentan terkoreksi sebelum entry."],
  risk: ["Stop loss dalam batas rencana", "Stop diletakkan di bawah support dan setidaknya 1,5 ATR dari entry. Jarak ini dihitung bersama fee dan slippage."],
  alignment: ["Tren utama dan pendukung sama-sama naik", "Harga harus di atas EMA21, EMA21 di atas EMA50, dan EMA50 di atas EMA200 pada timeframe yang disyaratkan."],
  structure: ["Ada konfirmasi harga terbaru", "Butuh candle naik dengan breakout high 20 candle sebelumnya atau struktur bullish yang sudah dikonfirmasi."],
  vwap: ["Harga di atas VWAP sesi", "Penutupan harus di atas rata-rata harga tertimbang volume sesi UTC yang diamati."],
  rsi: ["Momentum RSI berada di rentang entry", "RSI BUY memakai rentang 45–70. Angka ini adalah parameter strategi, bukan jaminan arah harga."],
  momentum: ["Momentum MACD positif", "Histogram MACD harus positif pada timeframe keputusan dan konfirmasi yang disyaratkan."],
  participation: ["Volume dan pembelian mendukung", "Volume relatif minimal 1,1× rata-rata sebelumnya; pangsa taker-buy minimal 52% pada window strategi."],
  score: ["Kesepakatan teknikal cukup", "Skor adalah jumlah aturan yang selaras. BUY tetap memerlukan semua pemeriksaan keselamatan dan konfirmasi."],
};
function decisionFrames(timeframe: Timeframe): Timeframe[] { return timeframe === "15m" ? ["15m", "1h", "4h"] : timeframe === "1h" ? ["1h", "4h", "1d"] : timeframe === "4h" ? ["4h", "1d"] : ["1d"]; }
export function explainCheck(check: QualificationCheck, setup: MarketSetup) {
  const timeframe = setup.timeframe ?? "1h", base = setup.indicators?.[timeframe];
  const [label, meaning] = labels[check.id] ?? [check.label, check.detail];
  let measured = "";
  if (["trend_safety", "alignment"].includes(check.id)) measured = decisionFrames(timeframe).map(tf => `${tf.toUpperCase()} ${setup.indicators?.[tf]?.trend === "bullish" ? "naik" : setup.indicators?.[tf]?.trend === "bearish" ? "turun" : "netral"}`).join(" · ");
  if (check.id === "risk") measured = positionLoss(setup) === null ? "Level stop atau target yang valid belum terbentuk." : `Estimasi rugi posisi ${positionLoss(setup)!.toFixed(2)}% · batas kebijakan ${setup.riskReview?.maximumLossPct ?? 8}%.`;
  if (check.id === "rsi" && base) measured = `${timeframe.toUpperCase()} RSI ${base.rsi.toFixed(1)} · rentang BUY 45–70.`;
  if (check.id === "volatility" && base) measured = `${timeframe.toUpperCase()} ATR ${(base.atr / setup.price * 100).toFixed(2)}% dari harga · batas kebijakan 6%.`;
  if (check.id === "extension" && base) measured = `RSI ${base.rsi.toFixed(1)} · jarak dari EMA21 ${base.atr > 0 ? ((setup.price - base.ema21) / base.atr).toFixed(2) : "—"} ATR.`;
  if (check.id === "score") measured = `${setup.score}/100 · minimal WAIT 50; batas skor awal BUY 78.`;
  if (check.id === "liquidity") measured = `Volume 24 jam ${(setup.quoteVolume24h / 1e6).toFixed(2)} juta USDT · minimum 5 juta.`;
  if (check.id === "participation" && setup.volume) measured = `Volume relatif ${setup.volume.relativeVolume.toFixed(2)}× · taker-buy ${(setup.volume.buyPressure * 100).toFixed(1)}%.`;
  if (check.id === "freshness") measured = `Candle keputusan ${new Date(setup.asOf).toLocaleString("id-ID")}. Status pemeriksaan dibekukan saat scan.`;
  return { label, meaning, measured };
}
export function explainDecision(setup: MarketSetup) {
  const blocked = setup.qualification?.filter(c => c.requiredFor === "plan" && !c.passed) ?? [];
  const risk = blocked.find(c => c.id === "risk");
  const loss = positionLoss(setup);
  if (setup.action === "NO TRADE" && risk && loss !== null && loss > (setup.riskReview?.maximumLossPct ?? 8)) return {
    title: "Stop loss terlalu jauh untuk aturan ini",
    summary: `Jika stop tersentuh, estimasi rugi ${loss.toFixed(2)}% dari nilai posisi, termasuk biaya. Batas ${setup.riskReview?.maximumLossPct ?? 8}% adalah kebijakan aplikasi untuk rencana ini. Risiko terhadap modal akun ditentukan lagi oleh ukuran posisi.`,
  };
  if (setup.action === "NO TRADE" && blocked.length) {
    const first = explainCheck(blocked[0], setup); return { title: first.label + " — belum terpenuhi", summary: [first.meaning, first.measured].filter(Boolean).join(" ") };
  }
  if (setup.action === "NO TRADE" && setup.score < 50) return { title: "Kesepakatan indikator belum cukup", summary: `Skor ${setup.score}/100 berada di bawah kriteria rencana yang layak. WAIT membutuhkan minimal 50 serta pemeriksaan keselamatan yang lolos. Skor ini mengukur keselarasan aturan, bukan peluang menang.` };
  if (setup.action === "NO TRADE") return { title: "Rencana belum memenuhi syarat strategi", summary: "Publikasi ini ditolak oleh aturan keselamatan atau kelayakan rencana. Rekaman lama belum menyertakan checklist terstruktur; alasan aslinya tersedia pada rincian setup. Skor tinggi tetap tidak menggantikan pemeriksaan tersebut." };
  if (setup.action === "WAIT") {
    const missing = setup.qualification?.filter(c => !c.passed && c.requiredFor === "buy").slice(0, 2).map(c => explainCheck(c, setup).label) ?? [];
    return { title: "Pantau dulu, konfirmasi belum lengkap", summary: missing.length ? `Syarat yang belum terpenuhi: ${missing.join("; ")}. Rencana WAIT belum dapat diambil sebagai trade virtual.` : "Tunggu tren, momentum, struktur dan volume memenuhi seluruh aturan BUY pada scan baru." };
  }
  return { title: "Setup memenuhi aturan pada saat scan", summary: "Entry tetap menunggu harga limit yang tercantum. Stop, target dan ukuran posisi dihitung dari data, biaya dan anggaran risiko; hasil trade masih perlu dievaluasi." };
}
