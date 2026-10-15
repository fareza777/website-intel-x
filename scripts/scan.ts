import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AnalyticsReport, Candle, MarketSnapshot, SignalEvent, StoredState, TrackedSignal } from "../lib/types";
import { activeStatuses, advanceSignal, emptyState, executionInterval, executionIntervalMs, publishSignals, uniqueEvents } from "../lib/tracking";
import { getCandles, getExchangeTime } from "../lib/market/binance";
import { scanMarket } from "../lib/market/scanner";
import { dataDirectory } from "../lib/storage";
import { scannerReportSchema } from "../lib/research/validation";
import type { ScannerValidationReport } from "../lib/research/types";

const FINAL = new Set(["TP3", "STOPPED", "EXPIRED", "INVALIDATED", "CLOSED"]);

export function parseScanSymbols(value?: string): string[] | undefined {
  if (!value?.trim()) return undefined;
  if (value.length > 2_000) throw new Error("SCAN_SYMBOLS is too long");
  const symbols = [...new Set(value.trim().toUpperCase().split(/[\s,]+/))];
  if (symbols.length > 50 || symbols.some((symbol) => !/^[A-Z0-9]{1,26}USDT$/.test(symbol))) throw new Error("SCAN_SYMBOLS must contain 1–50 comma/space-separated USDT symbols");
  return symbols;
}

export function candleStartTime(signal: TrackedSignal): number {
  const published = Date.parse(signal.publishedAt);
  if (!Number.isFinite(published) || !Number.isSafeInteger(signal.lastEvaluatedTime) || signal.lastEvaluatedTime < 0) throw new Error("Invalid published signal timestamps");
  const duration = executionIntervalMs(signal);
  return signal.lastEvaluatedTime ? signal.lastEvaluatedTime + duration : Math.ceil(published / duration) * duration;
}

export function retainSignals(signals: TrackedSignal[]): TrackedSignal[] {
  const active = signals.filter((signal) => activeStatuses.has(signal.status));
  const completed = signals.filter((signal) => !activeStatuses.has(signal.status)).sort((a, b) => {
    const at = (signal: TrackedSignal) => Date.parse(signal.exitAt ?? signal.events.at(-1)?.at ?? signal.publishedAt);
    return at(b) - at(a) || a.setup.id.localeCompare(b.setup.id);
  }).slice(0, 1_000);
  return [...active, ...completed];
}

export async function writeAtomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value), "utf8");
  await rename(temporary, file);
}

async function optionalFile(file: string): Promise<string | null> {
  try { return await readFile(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

function archiveMonth(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid archive record timestamp");
  return parsed.toISOString().slice(0, 7);
}

async function appendImmutable(file: string, records: { id: string }[]): Promise<void> {
  const prior = await optionalFile(file) ?? "";
  const known = new Map<string, string>();
  for (const line of prior.split("\n").filter(Boolean)) {
    const record = JSON.parse(line) as { id?: unknown };
    if (typeof record.id !== "string" || known.has(record.id)) throw new Error("Archive contains invalid or duplicate ids; preserve it for repair");
    known.set(record.id, line);
  }
  const appended: string[] = [];
  for (const record of records) {
    const line = JSON.stringify(record);
    const existing = known.get(record.id);
    if (existing && existing !== line) throw new Error("An immutable archive record changed; refusing to rewrite history");
    if (!existing) { known.set(record.id, line); appended.push(line); }
  }
  if (!appended.length) return;
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${prior}${prior && !prior.endsWith("\n") ? "\n" : ""}${appended.join("\n")}\n`, "utf8");
  await rename(temporary, file);
}

/** Archive every immutable BUY/WAIT original and terminal outcome before compacting state. */
export async function archiveState(directory: string, state: StoredState): Promise<void> {
  const groups = new Map<string, { id: string }[]>();
  const add = (kind: "originals" | "outcomes", at: string, record: { id: string }) => {
    const file = path.join(directory, "archives", kind, `${archiveMonth(at)}.jsonl`);
    groups.set(file, [...groups.get(file) ?? [], record]);
  };
  for (const signal of state.signals) {
    add("originals", signal.publishedAt, { version: 1, id: signal.setup.id, publishedAt: signal.publishedAt, setup: signal.setup } as { id: string });
    if (FINAL.has(signal.status)) {
      const finalAt = signal.exitAt ?? signal.events.at(-1)?.at ?? state.updatedAt;
      add("outcomes", finalAt, { version: 1, id: `${signal.setup.id}:FINAL`, signalId: signal.setup.id, symbol: signal.setup.symbol, action: signal.setup.action, status: signal.status, publishedAt: signal.publishedAt,
        enteredAt: signal.enteredAt, entryFill: signal.entryFill, exitAt: signal.exitAt, exitFill: signal.exitFill, highestTarget: signal.highestTarget, realizedReturnPct: signal.realizedReturnPct, events: signal.events } as { id: string });
    }
  }
  for (const [file, records] of groups) await appendImmutable(file, records);
}

async function archivedOriginalIds(directory: string): Promise<Set<string>> {
  const archive = path.join(directory, "archives/originals");
  let files: string[];
  try { files = await readdir(archive); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set(); throw error; }
  const ids = new Set<string>();
  for (const file of files.filter((name) => /^\d{4}-\d{2}\.jsonl$/.test(name))) {
    for (const line of (await readFile(path.join(archive, file), "utf8")).split("\n").filter(Boolean)) {
      const record = JSON.parse(line) as { id: unknown };
      if (typeof record.id !== "string") throw new Error("Invalid immutable original archive id");
      ids.add(record.id);
    }
  }
  return ids;
}

export interface DeliveryLedger { delivered: string[]; pending: SignalEvent[] }

export async function deliverWebhook(url: string, ledger: DeliveryLedger, fresh: SignalEvent[], fetcher: typeof fetch = fetch): Promise<DeliveryLedger> {
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("ALERT_WEBHOOK_URL must be an HTTPS URL without embedded credentials");
  const delivered = new Set(ledger.delivered);
  const pending = uniqueEvents([...ledger.pending, ...fresh]).filter((event) => !delivered.has(event.id));
  const batch = pending.slice(0, 50);
  if (!batch.length) return { delivered: [...delivered], pending };
  try {
    const response = await fetcher(endpoint, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json", "Idempotency-Key": createHash("sha256").update(batch.map((event) => event.id).join("\n")).digest("hex") },
      body: JSON.stringify({ version: 1, events: batch }), signal: AbortSignal.timeout(8_000) });
    await response.body?.cancel();
    if (response.ok) for (const event of batch) delivered.add(event.id);
  } catch { /* Best-effort optional delivery; preserve pending event ids for retry. */ }
  return { delivered: [...delivered], pending: pending.filter((event) => !delivered.has(event.id)) };
}

function readState(value: string | null): StoredState {
  if (value === null) return emptyState();
  const state = JSON.parse(value) as StoredState;
  if (state.version !== 1 || !Array.isArray(state.signals) || !Array.isArray(state.alerts) || typeof state.updatedAt !== "string"
    || state.signals.some((signal) => typeof signal.setup?.id !== "string" || !Array.isArray(signal.events) || !Number.isFinite(Date.parse(signal.publishedAt)))) throw new Error("Invalid stored state; refusing to overwrite it");
  return state;
}

async function analyticsReport(directory: string, previous: AnalyticsReport | null): Promise<AnalyticsReport | null> {
  const file = await optionalFile(path.join(directory, "analytics.json"));
  if (!file) return previous;
  try {
    const report = JSON.parse(file) as AnalyticsReport;
    if (!Number.isFinite(Date.parse(report.generatedAt)) || typeof report.symbol !== "string" || !Array.isArray(report.strategies) || !Array.isArray(report.notes) || typeof report.regime?.method !== "string") return previous;
    return report;
  } catch { return previous; }
}

async function scannerValidationReport(directory: string, previous: ScannerValidationReport | null): Promise<ScannerValidationReport | null> {
  try {
    const text = await optionalFile(path.join(directory, "scanner-validation.json"));
    if (!text || text.length > 8_000_000) return previous;
    const parsed = scannerReportSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : previous;
  } catch { return previous; }
}

interface PublisherOptions {
  directory: string;
  previous?: StoredState;
  now?: number;
  symbols?: string[];
  limit?: number;
  scan?: () => Promise<MarketSnapshot>;
  candles?: (symbol: string, interval: "15m" | "1h", limit?: number, startTime?: number) => Promise<Candle[]>;
  webhook?: string;
}

export async function runPublisher(options: PublisherOptions): Promise<{ exitCode: number; state: StoredState }> {
  const previous = structuredClone(options.previous ?? readState(await optionalFile(path.join(options.directory, "state.json"))));
  await archiveState(options.directory, previous);
  const archived = await archivedOriginalIds(options.directory);
  const attempted = await (options.scan ?? (() => scanMarket({ symbols: options.symbols, limit: options.limit })))();
  const now = options.now ?? (attempted.status === "unavailable" ? Date.now() : await getExchangeTime());
  const evaluationErrors: { symbol: string; message: string }[] = [];
  const evaluated = structuredClone(previous.signals);
  if (attempted.status !== "unavailable") {
    const deadline = Date.now() + 90_000;
    let cursor = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (cursor < evaluated.length) {
        const index = cursor++; const signal = evaluated[index];
        if (!activeStatuses.has(signal.status)) continue;
        if (Date.now() >= deadline) { evaluationErrors.push({ symbol: signal.setup.symbol, message: "Outcome evaluation deferred: publisher time budget reached" }); continue; }
        try {
          const candles = await (options.candles ?? getCandles)(signal.setup.symbol, executionInterval(signal), 1_000, candleStartTime(signal));
          evaluated[index] = advanceSignal(signal, candles, now);
          const gap = evaluated[index].events.find((event) => event.type === "DATA GAP");
          if (gap && evaluated[index].lastEvaluatedTime === signal.lastEvaluatedTime) evaluationErrors.push({ symbol: signal.setup.symbol, message: "Outcome evaluation paused: missing closed execution history" });
        } catch { evaluationErrors.push({ symbol: signal.setup.symbol, message: "Outcome evaluation deferred: closed execution data unavailable" }); }
      }
    }));
  }
  const outage = attempted.status === "unavailable";
  // Publication is a later event than scan start: never backdate a new executable original.
  const publicationTime = options.now ?? (outage ? Date.now() : await getExchangeTime());
  const publicationAt = new Date(publicationTime).toISOString();
  const snapshot: MarketSnapshot = outage && previous.snapshot ? { ...previous.snapshot, status: "unavailable", generatedAt: attempted.generatedAt, errors: attempted.errors, durationMs: attempted.durationMs, scanned: 0 }
    : { ...attempted, status: evaluationErrors.length && attempted.status === "live" ? "partial" : attempted.status, errors: [...attempted.errors, ...evaluationErrors] };
  let next: StoredState = { ...previous, signals: evaluated, snapshot, updatedAt: publicationAt };
  if (!outage) {
    const horizons = snapshot.timeframes ? Object.values(snapshot.timeframes).flat() : [];
    const research = horizons.length ? horizons : snapshot.setups;
    next = publishSignals(next, { ...snapshot, setups: research.filter((setup) => !archived.has(setup.id)) }, publicationAt);
    next.snapshot = snapshot;
  }
  const previousEventIds = new Set(previous.signals.flatMap((signal) => signal.events.map((event) => event.id)));
  const fresh = uniqueEvents(next.signals.flatMap((signal) => signal.events)).filter((event) => !previousEventIds.has(event.id) && event.type !== "CONDITIONAL");
  next.alerts = uniqueEvents([...next.alerts, ...fresh]).slice(-200);
  next.analytics = await analyticsReport(options.directory, previous.analytics);
  next.scannerValidation = await scannerValidationReport(options.directory, previous.scannerValidation ?? null);
  await archiveState(options.directory, next);
  next.signals = retainSignals(next.signals);
  await writeAtomicJson(path.join(options.directory, "state.json"), next);
  let webhookPending = 0;
  let webhookWarning: string | null = null;
  if (options.webhook) {
    try {
      const priorDelivery = await optionalFile(path.join(options.directory, "alert-delivery.json"));
      const ledger = priorDelivery ? JSON.parse(priorDelivery) as DeliveryLedger : { delivered: [], pending: [] };
      if (!Array.isArray(ledger.delivered) || !Array.isArray(ledger.pending)) throw new Error("Invalid delivery ledger");
      const delivered = await deliverWebhook(options.webhook, ledger, fresh);
      await writeAtomicJson(path.join(options.directory, "alert-delivery.json"), delivered);
      webhookPending = delivered.pending.length;
      if (webhookPending) webhookWarning = "Webhook events remain pending; delivery will retry on a later publisher run";
    } catch { webhookWarning = "Webhook configuration or delivery ledger is invalid; scan state was preserved"; }
  }
  await writeAtomicJson(path.join(options.directory, "scan-report.json"), { version: 1, attemptedAt: publicationAt, status: attempted.status, universeSize: attempted.universeSize, scanned: attempted.scanned, errors: attempted.errors,
    evaluationErrors, published: fresh.filter((event) => event.type === "PUBLISHED").length, newEvents: fresh.length, active: next.signals.filter((signal) => activeStatuses.has(signal.status)).length, webhookPending, webhookWarning });
  return { exitCode: outage ? 1 : 0, state: next };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((argument) => !["--publish", "--preview"].includes(argument)) || args.includes("--publish") && args.includes("--preview")) throw new Error("Usage: npm run scan -- [--preview|--publish]");
  const symbols = parseScanSymbols(process.env.SCAN_SYMBOLS);
  const limit = process.env.SCAN_LIMIT ? Number(process.env.SCAN_LIMIT) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < (symbols ? 1 : 20) || limit > 50)) throw new Error("SCAN_LIMIT must be an integer from 20–50, or 1–50 for an explicit watchlist");
  if (args.includes("--publish")) {
    const result = await runPublisher({ directory: dataDirectory, symbols, limit, webhook: process.env.ALERT_WEBHOOK_URL });
    const current = result.state.snapshot!;
    console.log(JSON.stringify({ mode: "publisher", status: current.status, scanned: current.scanned, dataAsOf: current.dataAsOf, active: result.state.signals.filter((signal) => activeStatuses.has(signal.status)).length, errors: current.errors }));
    process.exitCode = result.exitCode;
  } else {
    const snapshot = await scanMarket({ symbols, limit });
    await writeAtomicJson(path.join(dataDirectory, "preview.json"), snapshot);
    console.log(JSON.stringify({ mode: "preview", status: snapshot.status, scanned: snapshot.scanned, dataAsOf: snapshot.dataAsOf, actions: snapshot.setups.reduce<Record<string, number>>((counts, setup) => { counts[setup.action] = (counts[setup.action] ?? 0) + 1; return counts; }, {}), errors: snapshot.errors }));
    process.exitCode = snapshot.status === "unavailable" ? 1 : 0;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error("Publisher failed safely. Existing state and archives were preserved; inspect configuration and prior diagnostics."); process.exitCode = 1; });
}
