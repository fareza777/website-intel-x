"use client";
export function Sparkline({ values, negative = false }: { values: number[]; negative?: boolean }) {
  if (values.length < 2) return <span className="spark-empty">No price history</span>;
  const min = Math.min(...values), range = Math.max(...values) - min || 1;
  const points = values.map((n, i) => `${i / (values.length - 1) * 160},${43 - (n - min) / range * 36}`).join(" ");
  const last = values.length - 1, endY = 43 - (values[last] - min) / range * 36;
  // pathLength lets CSS draw the line in regardless of its true length; the end dot marks the latest close.
  return <svg className={negative ? "sparkline down" : "sparkline up"} viewBox="0 0 160 48" aria-label="Recent closed price history" role="img">
    <polyline points={points} pathLength={1} className="spark-line" fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    <circle cx="160" cy={endY} r="2.6" className="spark-end" />
  </svg>;
}
