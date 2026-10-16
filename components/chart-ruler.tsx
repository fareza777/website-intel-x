"use client";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { IChartApi } from "lightweight-charts";
import type { MeasurementPoint } from "@/lib/chart-measurement";
import { measurementPrice, measurePriceMove } from "@/lib/chart-measurement";
import { percent } from "@/lib/utils";

type Coordinates = { x: number; y: number };
type Selection = { start: MeasurementPoint; end: MeasurementPoint };
interface Projection { width: number; height: number; start: Coordinates | null; end: Coordinates | null }
export interface RulerSeries { coordinateToPrice(y: number): number | null; priceToCoordinate(price: number): number | null }

export function ChartRuler({ chartRef, seriesRef, times, intervalMs, enabled, revision, onEscape }: {
  chartRef: RefObject<IChartApi | null>; seriesRef: RefObject<RulerSeries | null>; times: number[]; intervalMs: number;
  enabled: boolean; revision: unknown; onEscape: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const selected = useRef<Selection | null>(null);
  const gesture = useRef<{ id: number; x: number; y: number; second: boolean; moved: boolean } | null>(null);
  const waiting = useRef(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [awaitingEnd, setAwaitingEnd] = useState(false);
  const [projection, setProjection] = useState<Projection>({ width: 0, height: 0, start: null, end: null });
  const project = useCallback(() => {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series) return;
    const scale = chart.timeScale();
    const coordinates = (point: MeasurementPoint): Coordinates | null => {
      const x = scale.timeToCoordinate(point.time / 1000 as import("lightweight-charts").UTCTimestamp), y = series.priceToCoordinate(point.price);
      return x === null || y === null ? null : { x, y };
    };
    const next = { width: scale.width(), height: chart.panes()[0]?.getHeight() ?? 0, start: selected.current ? coordinates(selected.current.start) : null, end: selected.current ? coordinates(selected.current.end) : null };
    setProjection(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, [chartRef, seriesRef]);

  useEffect(() => {
    let animation = 0, chart: IChartApi | null = null;
    const schedule = () => { cancelAnimationFrame(animation); animation = requestAnimationFrame(project); };
    const parent = host.current?.parentElement;
    const observer = new ResizeObserver(schedule);
    if (parent) { observer.observe(parent); parent.addEventListener("pointermove", schedule, true); parent.addEventListener("pointerup", schedule, true); parent.addEventListener("wheel", schedule, true); }
    const initialization = requestAnimationFrame(() => {
      chart = chartRef.current;
      chart?.timeScale().subscribeVisibleLogicalRangeChange(schedule);
      chart?.timeScale().subscribeSizeChange(schedule);
      project();
    });
    return () => {
      cancelAnimationFrame(initialization); cancelAnimationFrame(animation); observer.disconnect();
      parent?.removeEventListener("pointermove", schedule, true); parent?.removeEventListener("pointerup", schedule, true); parent?.removeEventListener("wheel", schedule, true);
      try { chart?.timeScale().unsubscribeVisibleLogicalRangeChange(schedule); chart?.timeScale().unsubscribeSizeChange(schedule); } catch { /* The parent may already have replaced the chart. */ }
    };
  }, [chartRef, project, revision, times]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && (enabled || selected.current)) onEscape(); };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [enabled, onEscape]);

  function point(event: React.PointerEvent<SVGSVGElement>): MeasurementPoint | null {
    const chart = chartRef.current, series = seriesRef.current;
    if (!chart || !series || !times.length) return null;
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left, y = event.clientY - box.top;
    if (x < 0 || x > chart.timeScale().width() || y < 0 || y > (chart.panes()[0]?.getHeight() ?? 0)) return null;
    const logical = chart.timeScale().coordinateToLogical(x), price = series.coordinateToPrice(y);
    if (logical === null || price === null || !Number.isFinite(price) || price <= 0) return null;
    const index = Math.round(logical);
    if (index < 0 || index >= times.length) return null;
    return { time: times[index], price };
  }
  function update(next: Selection) { selected.current = next; setSelection(next); project(); }
  const result = selection ? measurePriceMove(selection.start, selection.end, intervalMs) : null;
  const start = projection.start, end = projection.end;
  const color = result && result.percentChange < 0 ? "#ee9bb0" : "#9bc2ff";
  return <div ref={host} className="chart-ruler" data-testid="chart-ruler">
    <svg className={enabled ? "ruler-overlay active" : "ruler-overlay"} style={{ width: projection.width, height: projection.height }} aria-label="Price measurement drawing area"
      onPointerDown={event => {
        if (!enabled || event.button !== 0) return;
        const next = point(event); if (!next) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        const second = waiting.current && !!selected.current;
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, second };
        update(second ? { start: selected.current!.start, end: next } : { start: next, end: next });
        waiting.current = true; setAwaitingEnd(true);
      }}
      onPointerMove={event => {
        if (!enabled || !selected.current || (!gesture.current && !waiting.current)) return;
        const next = point(event); if (!next) return;
        if (gesture.current) gesture.current.moved ||= Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 3;
        update({ start: selected.current.start, end: next });
      }}
      onPointerUp={event => {
        const active = gesture.current; if (!active || active.id !== event.pointerId) return;
        const next = point(event); if (next && selected.current) update({ start: selected.current.start, end: next });
        if (active.moved || active.second) { waiting.current = false; setAwaitingEnd(false); }
        gesture.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => { gesture.current = null; waiting.current = false; setAwaitingEnd(false); }}>
      {start && end && <g fill="none" stroke={color} strokeWidth="1.5">
        <rect x={Math.min(start.x, end.x)} y={Math.min(start.y, end.y)} width={Math.max(1, Math.abs(end.x - start.x))} height={Math.max(1, Math.abs(end.y - start.y))} fill={color} fillOpacity=".08" strokeDasharray="4 4" />
        <path d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`} strokeWidth="2" />
        <circle cx={start.x} cy={start.y} r="4" fill="#121b29" /><circle cx={end.x} cy={end.y} r="4" fill={color} />
      </g>}
    </svg>
    {result && selection && <div className="ruler-readout" role="status" aria-label="Price measurement" style={{ bottom: `calc(100% - ${projection.height}px + 12px)` }}>
      <span>{awaitingEnd ? "Choose end point" : "Price measurement"}</span>
      <strong className={result.percentChange < 0 ? "negative" : "positive"} data-testid="measurement-percent">{percent(result.percentChange)}</strong>
      <div><b>{measurementPrice(selection.start.price)} → {measurementPrice(selection.end.price)}</b><span>{result.priceChange >= 0 ? "+" : "−"}{measurementPrice(Math.abs(result.priceChange))}</span></div>
      <small>{result.bars} candle intervals · {(result.durationMs / 3_600_000).toLocaleString("en-US", { maximumFractionDigits: 2 })} hours</small>
    </div>}
    {enabled && !selection && <div className="ruler-hint">Drag between two prices, or click a start and end point.</div>}
  </div>;
}
