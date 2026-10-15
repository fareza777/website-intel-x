"use client";
export function Sparkline({ values, negative = false }: { values: number[]; negative?: boolean }) {
  if (values.length < 2) return <span className="spark-empty">No price history</span>;
  const min = Math.min(...values), range = Math.max(...values) - min || 1;
  const points = values.map((n, i) => `${i / (values.length - 1) * 160},${43 - (n - min) / range * 36}`).join(" ");
  return <svg className="sparkline" viewBox="0 0 160 48" aria-label="Recent closed price history" role="img"><polyline points={points} fill="none" stroke={negative ? "#df748a" : "#74a5ff"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}
