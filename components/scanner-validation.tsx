"use client";
import { useEffect, useState } from "react";
import { ArrowDownToLine, Database, FlaskConical, ShieldAlert } from "lucide-react";
import type { Timeframe } from "@/lib/types";
import type { ScannerValidationReport, ScannerValidationRow } from "@/lib/research/types";
import { downloadJson } from "@/lib/download";
import { cn, dollars, percent } from "@/lib/utils";
import { Button } from "./ui/button";

const frames: Timeframe[] = ["15m", "1h", "4h", "1d"];
const date = (value: string) => new Date(value).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Jakarta" });
const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const evidenceLabel = (row: ScannerValidationRow) => row.evidence === "insufficient" ? "Sampel belum cukup" : row.evidence === "unfavorable" ? "Hasil kurang mendukung" : "Positif pada sampel ini";
export function ScannerValidation({ report }: { report: ScannerValidationReport | null }) {
  const [frame, setFrame] = useState<Timeframe>("15m");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  if (!report) return <section className="panel scanner-evidence"><div className="panel-heading"><h2>Replay scanner asli</h2><FlaskConical size={22} /></div><p className="panel-note">Belum ada replay aturan rekomendasi yang dipublikasikan. Hasil strategi pembanding di bawah tidak membuktikan performa scanner. Tidak ada hasil contoh yang ditampilkan.</p></section>;
  const rows = report.rows.filter(row => row.timeframe === frame);
  const selected = rows.find(row => row.symbol === symbol) ?? rows[0];
  const completed = report.rows.reduce((sum, row) => sum + row.completed, 0);
  const aged = now - Date.parse(report.generatedAt) > 48 * 3_600_000;
  return <section className="panel scanner-evidence">
    <div className="evidence-heading"><div><span className="eyebrow">ACTUAL SCANNER · {report.strategyVersion}</span><h2>Buktinya, sebelum keyakinannya.</h2><p>Replay aturan rekomendasi yang sama pada histori Binance. {date(report.start)} — {date(report.end)}.</p></div><Button variant="outline" onClick={() => downloadJson("cryptointel-scanner-replay.json", report)}><ArrowDownToLine size={17} />Ekspor bukti</Button></div>
    <div className="evidence-verdict"><ShieldAlert size={24} /><div><strong>{report.rows.some(row => row.evidence === "insufficient") ? "Bukti performa masih terbatas" : "Hasil historis perlu diuji ke depan"}</strong><p>{completed} trade selesai di seluruh akun terpisah. Nama indikator standar atau repo populer tidak membuktikan strategi ini menguntungkan. Skor setup tetap bukan peluang menang.</p></div></div>
    <div className="evidence-assumptions"><span><b>{money(report.capitalPerAccount)}</b> per akun pair × horizon</span><span><b>{report.initialCapitalRiskPct}%</b> risiko modal awal</span><span><b>{(report.feeBps / 100).toFixed(2)}% + {(report.slippageBps / 100).toFixed(2)}%</b> fee + slippage / sisi</span><span><b>Setiap jam, :17</b> asumsi publikasi</span></div>
    <div className="evidence-controls"><div className="horizon-switch" aria-label="Timeframe replay">{frames.map(tf => <button key={tf} aria-pressed={frame === tf} className={cn(frame === tf && "active")} onClick={() => setFrame(tf)}>{tf.toUpperCase()}</button>)}</div><span><Database size={15} />Diperbarui {new Date(report.generatedAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB</span></div>
    {aged && <p className="warning-note">Laporan lebih dari 48 jam. Ini hasil historis terakhir yang tersedia, bukan hasil yang baru dihitung.</p>}
    {report.failures.length > 0 && <p className="warning-note">Data replay tidak lengkap: {report.failures.map(failure => `${failure.symbol}: ${failure.message}`).join("; ")}. Pasar yang gagal tidak dianggap return nol.</p>}
    <div className="table-scroll"><table className="evidence-table"><thead><tr><th>Pasar</th><th>BUY terbit</th><th>Trade selesai</th><th>Win rate</th><th>Profit factor</th><th>Return akun</th><th>Drawdown</th><th>Bukti</th></tr></thead><tbody>{rows.map(row => <tr key={row.symbol} className={cn(selected?.symbol === row.symbol && "selected")}><td><button onClick={() => setSymbol(row.symbol)} aria-pressed={selected?.symbol === row.symbol}>{row.symbol.replace("USDT", " / USDT")}</button></td><td>{row.publishedBuy}</td><td>{row.completed}</td><td>{row.winRate === null ? "—" : `${row.winRate.toFixed(1)}%`}</td><td>{row.profitFactor === null ? "—" : row.profitFactor.toFixed(2)}</td><td className={row.netReturnPct < 0 ? "negative" : ""}>{percent(row.netReturnPct)}</td><td>{row.maxDrawdownPct.toFixed(2)}%</td><td><span className="evidence-status">{evidenceLabel(row)}</span></td></tr>)}</tbody></table></div>
    {!rows.length && <p className="panel-note">Replay horizon ini tidak tersedia. Periksa kegagalan data di atas.</p>}
    {selected && <div className="evidence-detail"><div className="panel-heading"><h3>{selected.symbol.replace("USDT", " / USDT")} · {frame.toUpperCase()}</h3><span className="micro-tag">{selected.scans.toLocaleString("id-ID")} SCANS</span></div>
      <p className="panel-note">{selected.filled} entry terisi · {selected.expired} BUY expired · {selected.invalidated} BUY invalidated · {selected.pending} pending · {selected.open} terbuka · {selected.unsized} gagal ukuran minimum. Return akun memasukkan mark posisi terbuka setelah estimasi biaya keluar; win rate hanya trade selesai.</p>
      {selected.filled > 0 ? <EvidenceEquity row={selected} /> : <p className="evidence-no-trades">Belum ada entry terisi. Return nol di sini berarti akun tetap tunai, bukan bukti strategi aman atau menguntungkan.</p>}
      <div className="evidence-windows">{selected.windows.map((window, i) => <div key={window.start}><span>Periode {i + 1} · {window.completed} trade selesai</span><strong className={window.netReturnPct < 0 ? "negative" : ""}>{percent(window.netReturnPct)}</strong><small>{date(window.start)} — {date(window.end)}</small></div>)}</div>
      <p className="panel-note">Tiga periode berurutan memakai akun yang berlanjut. Pembagian ini bersifat deskriptif; bukan tiga pengujian out-of-sample yang belum pernah dilihat.</p>
      <details className="evidence-audit"><summary>Audit {selected.completed} trade selesai & asumsi perhitungan</summary><p>Expectancy trade: <b>{selected.expectancyPct === null ? "—" : percent(selected.expectancyPct)}</b>. Fee dan slippage sudah dihitung. TP1/2 adalah milestone, tanpa mencatat profit parsial.</p>
        {selected.trades.length > 0 && <div className="table-scroll"><table className="evidence-table"><thead><tr><th>Entry · WIB</th><th>Exit · WIB</th><th>Entry fill</th><th>Exit fill</th><th>P/L bersih</th><th>Status</th></tr></thead><tbody>{selected.trades.map(trade => <tr key={trade.id}><td>{new Date(trade.enteredAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td><td>{new Date(trade.exitAt).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })}</td><td>{dollars(trade.entryFill)}</td><td>{dollars(trade.exitFill)}</td><td className={trade.pnl < 0 ? "negative" : ""}>{money(trade.pnl)} · {percent(trade.returnPct)}</td><td>{trade.status}</td></tr>)}</tbody></table></div>}
        <p>{report.closedWindow} candle tertutup per frame. 15M dievaluasi pada candle eksekusi 15 menit; horizon lain memakai candle 1 jam. Publikasi GitHub sebenarnya dapat terlambat dari asumsi :17.</p>
        <p>Ticker historis 24 jam direkonstruksi dari candle 1H tertutup. Universe BTC/ETH/SOL dan filter exchange saat ini membatasi generalisasi. Fill OHLC adalah simulasi, tanpa verifikasi transaksi per tick.</p>
        <p>Kurang dari 30 trade selesai diberi label sampel terbatas. Angka 30 merupakan peringatan ukuran sampel, bukan uji signifikansi. Hasil positif juga tidak menjamin profit berikutnya.</p>
        <details><summary>Catatan runner & identitas kode</summary>{report.notes.map((note, i) => <p key={i}>{note}</p>)}<code className="evidence-hash">SHA256 {report.codeHash}</code></details>
      </details>
    </div>}
  </section>;
}
function EvidenceEquity({ row }: { row: ScannerValidationRow }) {
  if (row.equity.length < 2) return <p className="panel-note">Observasi ekuitas tidak cukup untuk grafik.</p>;
  const values = row.equity.map(point => point.value), low = Math.min(...values), high = Math.max(...values), spread = high - low || 1;
  const points = row.equity.map((point, i) => `${i / (row.equity.length - 1) * 800},${160 - (point.value - low) / spread * 130}`).join(" ");
  return <div className="evidence-equity"><div><span>Ekuitas akun · sampel harian</span><b>{money(values[0])} → {money(values.at(-1)!)}</b></div><svg viewBox="0 0 800 185" role="img" aria-label={`Ekuitas ${row.symbol} ${row.timeframe}, ${money(low)} sampai ${money(high)}`}><path d="M0 30H800M0 95H800M0 160H800" stroke="#293145" fill="none" /><polyline points={points} stroke={row.netReturnPct < 0 ? "#e399ac" : "#8dafff"} strokeWidth="2.5" fill="none" /></svg></div>;
}
