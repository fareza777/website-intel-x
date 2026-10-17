"use client";
import { useState } from "react";
import { ArrowUpRight, BookOpen, ChevronRight, Search } from "lucide-react";
import { GUIDE_ARTICLES, GLOSSARY, METHOD_SOURCES, type GuideTopic, type WorkspacePage } from "@/lib/guide";
import { Button } from "./ui/button";
import { QUALIFICATION_POLICIES, STRATEGY_VERSION } from "@/lib/market/policy";
export function GuideView({ topic, onTopic, onNavigate }: { topic: GuideTopic; onTopic: (topic: GuideTopic) => void; onNavigate: (page: WorkspacePage) => void }) {
  const [query, setQuery] = useState("");
  const article = GUIDE_ARTICLES.find(a => a.id === topic) ?? GUIDE_ARTICLES[0];
  const search = query.trim().toLocaleLowerCase("en-US");
  const matches = GUIDE_ARTICLES.filter(a => `${a.title} ${a.subtitle} ${a.purpose} ${a.metrics.flat().join(" ")}`.toLocaleLowerCase("en-US").includes(search));
  const terms = GLOSSARY.filter(term => term.join(" ").toLocaleLowerCase("en-US").includes(search));
  return <div className="guide-layout">
    <aside className="guide-index panel"><div className="guide-index-heading"><BookOpen size={22} /><div><strong>Terminal guide</strong><span>Purpose, metrics and usage.</span></div></div><label className="guide-search"><Search size={18} /><input aria-label="Search guide" placeholder="Search ATR, stops, pages…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <nav aria-label="Guide topics">{matches.map((a, i) => <button className={a.id === topic ? "active" : ""} onClick={() => { onTopic(a.id); setQuery(""); }} key={a.id}><span>{String(i + 1).padStart(2, "0")}</span>{a.title}<ChevronRight size={17} /></button>)}{!matches.length && <p className="guide-no-results">No matching topics. Try another term or open the glossary.</p>}</nav>
      <button className="guide-glossary-link" onClick={() => onTopic("glossary")}>Open glossary<ArrowUpRight size={17} /></button>
    </aside>
    <article className="guide-article panel"><header><span className="eyebrow">CRYPTOSCANORA / GUIDE</span><h2>{article.title}</h2><p>{article.subtitle}</p>{article.page && <Button variant="outline" onClick={() => onNavigate(article.page!)}>Open page<ArrowUpRight size={17} /></Button>}</header>
      <section><h3>Purpose</h3><p>{article.purpose}</p></section>
      {!!article.metrics.length && <section><h3>Key metrics & terms</h3><dl className="guide-definitions">{article.metrics.map(([title, detail]) => <div key={title}><dt>{title}</dt><dd>{detail}</dd></div>)}</dl></section>}
      {!!article.steps.length && <section><h3>How to use it</h3><ol className="guide-steps">{article.steps.map(step => <li key={step}>{step}</li>)}</ol></section>}
      {topic === "method" && <>
        <section><h3>Risk limits · {STRATEGY_VERSION}</h3><p>These limits define application tolerances for each horizon. Your account risk budget still follows your settings; a wider stop reduces position size.</p><div className="table-scroll"><table className="data-table"><thead><tr><th>Horizon</th><th>Max ATR</th><th>Max position loss</th><th>Min BUY score</th></tr></thead><tbody>{Object.entries(QUALIFICATION_POLICIES).map(([tf, policy]) => <tr key={tf}><td>{tf.toUpperCase()}</td><td>{policy.maximumAtrPct}%</td><td>{policy.maximumStopRiskPct}%</td><td>{policy.minimumBuyScore}/100</td></tr>)}</tbody></table></div></section>
        <section><h3>Plan windows by horizon</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Horizon</th><th>Trend context</th><th>Entry expiry</th><th>Max hold</th><th>Execution candle</th></tr></thead><tbody>{[["15M", "1H + 4H", "6 hours", "18 hours", "15 minutes"], ["1H", "4H + 1D", "24 hours", "72 hours", "1 hour"], ["4H", "1D", "72 hours", "216 hours", "1 hour"], ["1D", "1D", "168 hours", "720 hours", "1 hour"]].map(row => <tr key={row[0]}>{row.map(cell => <td key={cell}>{cell}</td>)}</tr>)}</tbody></table></div></section>
        <section><h3>What does “tested” mean?</h3><p>Calculation tests check formulas and data timing. Replay measures the same rules on real history. Signal Autopsy measures outcomes after publication. Strong evidence needs enough trades, multiple market conditions, realistic costs and further evaluation without changing rules to fit results already seen.</p><p>Strategy Lab shows the scope and limits of the available evidence. Small samples and negative results help assess whether a strategy deserves confidence.</p><Button variant="outline" onClick={() => onNavigate("strategy")}>Review Strategy Lab evidence<ArrowUpRight size={17} /></Button></section>
      </>}
      {topic === "glossary" && <dl className="guide-definitions glossary-definitions">{terms.map(([title, detail]) => <div key={title}><dt>{title}</dt><dd>{detail}</dd></div>)}{!terms.length && <p>No matching terms.</p>}</dl>}
      <p className="guide-note">{article.note}</p>
      {(topic === "method" || topic === "chart" || topic === "strategy") && <section><h3>Sources to review</h3><div className="method-sources">{METHOD_SOURCES.map(source => <a href={source.url} target="_blank" rel="noreferrer" key={source.name}><div><strong>{source.name}</strong><ArrowUpRight size={19} /></div><span>{source.license}</span><p>{source.detail}</p></a>)}</div></section>}
      {topic !== "method" && <button className="text-button" onClick={() => onTopic("method")}><BookOpen size={18} />Explore the method, risk limits and evidence<ChevronRight size={18} /></button>}
    </article>
  </div>;
}
