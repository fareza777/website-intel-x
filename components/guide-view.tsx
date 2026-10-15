"use client";
import { useState } from "react";
import { ArrowUpRight, BookOpen, ChevronRight, Search } from "lucide-react";
import { GUIDE_ARTICLES, GLOSSARY, METHOD_SOURCES, type GuideTopic, type WorkspacePage } from "@/lib/guide";
import { Button } from "./ui/button";
export function GuideView({ topic, onTopic, onNavigate }: { topic: GuideTopic; onTopic: (topic: GuideTopic) => void; onNavigate: (page: WorkspacePage) => void }) {
  const [query, setQuery] = useState("");
  const article = GUIDE_ARTICLES.find(a => a.id === topic) ?? GUIDE_ARTICLES[0];
  const search = query.trim().toLocaleLowerCase("id-ID");
  const matches = GUIDE_ARTICLES.filter(a => `${a.title} ${a.subtitle} ${a.purpose} ${a.metrics.flat().join(" ")}`.toLocaleLowerCase("id-ID").includes(search));
  const terms = GLOSSARY.filter(term => term.join(" ").toLocaleLowerCase("id-ID").includes(search));
  return <div className="guide-layout">
    <aside className="guide-index panel"><div className="guide-index-heading"><BookOpen size={22} /><div><strong>Panduan terminal</strong><span>Tujuan, angka, dan cara pakai.</span></div></div><label className="guide-search"><Search size={18} /><input aria-label="Cari panduan" placeholder="Cari ATR, stop, halaman…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <nav aria-label="Topik panduan">{matches.map((a, i) => <button className={a.id === topic ? "active" : ""} onClick={() => { onTopic(a.id); setQuery(""); }} key={a.id}><span>{String(i + 1).padStart(2, "0")}</span>{a.title}<ChevronRight size={17} /></button>)}{!matches.length && <p className="guide-no-results">Tidak ada judul yang cocok. Coba istilah lain atau buka Kamus istilah.</p>}</nav>
      <button className="guide-glossary-link" onClick={() => onTopic("glossary")}>Buka kamus istilah<ArrowUpRight size={17} /></button>
    </aside>
    <article className="guide-article panel"><header><span className="eyebrow">CRYPTOINTEL X / PANDUAN</span><h2>{article.title}</h2><p>{article.subtitle}</p>{article.page && <Button variant="outline" onClick={() => onNavigate(article.page!)}>Buka halaman ini<ArrowUpRight size={17} /></Button>}</header>
      <section><h3>Untuk apa halaman ini?</h3><p>{article.purpose}</p></section>
      {!!article.metrics.length && <section><h3>Angka dan istilah yang perlu dibaca</h3><dl className="guide-definitions">{article.metrics.map(([title, detail]) => <div key={title}><dt>{title}</dt><dd>{detail}</dd></div>)}</dl></section>}
      {!!article.steps.length && <section><h3>Cara menggunakan</h3><ol className="guide-steps">{article.steps.map(step => <li key={step}>{step}</li>)}</ol></section>}
      {topic === "method" && <>
        <section><h3>Jendela rencana per horizon</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Horizon</th><th>Konfirmasi tren</th><th>Expiry entry</th><th>Maksimum hold</th><th>Candle eksekusi</th></tr></thead><tbody>{[["15M", "1H + 4H", "6 jam", "18 jam", "15 menit"], ["1H", "4H + 1D", "24 jam", "72 jam", "1 jam"], ["4H", "1D", "72 jam", "216 jam", "1 jam"], ["1D", "1D", "168 jam", "720 jam", "1 jam"]].map(row => <tr key={row[0]}>{row.map(cell => <td key={cell}>{cell}</td>)}</tr>)}</tbody></table></div></section>
        <section><h3>Apa yang dimaksud “sudah diuji”?</h3><p>Pengujian perhitungan memeriksa rumus dan waktu data. Replay mengukur aturan yang sama pada histori nyata. Signal Autopsy mengukur hasil setelah publikasi. Bukti yang kuat memerlukan sampel yang cukup, hasil di beberapa kondisi pasar, biaya realistis dan evaluasi berikutnya tanpa mengubah aturan berdasarkan hasil yang sudah dilihat.</p><p>Strategy Lab menampilkan cakupan dan keterbatasan bukti yang tersedia. Sampel kecil atau hasil negatif tetap menjadi informasi penting untuk memutuskan apakah strategi layak dipercaya.</p><Button variant="outline" onClick={() => onNavigate("strategy")}>Periksa bukti di Strategy Lab<ArrowUpRight size={17} /></Button></section>
      </>}
      {topic === "glossary" && <dl className="guide-definitions glossary-definitions">{terms.map(([title, detail]) => <div key={title}><dt>{title}</dt><dd>{detail}</dd></div>)}{!terms.length && <p>Tidak ada istilah yang cocok.</p>}</dl>}
      <p className="guide-note">{article.note}</p>
      {(topic === "method" || topic === "chart" || topic === "strategy") && <section><h3>Referensi yang dapat Anda periksa</h3><div className="method-sources">{METHOD_SOURCES.map(source => <a href={source.url} target="_blank" rel="noreferrer" key={source.name}><div><strong>{source.name}</strong><ArrowUpRight size={19} /></div><span>{source.license}</span><p>{source.detail}</p></a>)}</div></section>}
      {topic !== "method" && <button className="text-button" onClick={() => onTopic("method")}><BookOpen size={18} />Pelajari metode, batas risiko dan bukti strateginya<ChevronRight size={18} /></button>}
    </article>
  </div>;
}
