import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { emptyState } from "./tracking";
import type { StoredState } from "./types";

export const dataDirectory = process.env.DATA_DIRECTORY || path.join(process.cwd(), "data");
const stateFile = path.join(dataDirectory, "state.json");
const repo = process.env.MARKET_DATA_REPOSITORY || "fareza777/website-intel-x";

export async function readLocalState(): Promise<StoredState> {
  try { return JSON.parse(await readFile(stateFile, "utf8")) as StoredState; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState(); throw error; }
}

export async function writeLocalState(state: StoredState): Promise<void> {
  await mkdir(dataDirectory, { recursive: true });
  const temp = `${stateFile}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(state), "utf8");
  await rename(temp, stateFile);
}

let cached: { expires: number; value: StoredState } | null = null;
function isPublishedState(value: unknown): value is StoredState {
  if (!value || typeof value !== "object") return false;
  const state = value as StoredState;
  return state.version === 1 && typeof state.updatedAt === "string" && Array.isArray(state.signals) && Array.isArray(state.alerts)
    && !!state.snapshot && Array.isArray(state.snapshot.setups);
}
export async function readPublishedState(): Promise<{ state: StoredState; persistence: "github" | "local" | "unavailable" }> {
  let local: StoredState | null = null;
  if (!process.env.VERCEL) {
    try {
      const candidate = await readLocalState();
      if (isPublishedState(candidate)) local = candidate;
    } catch (error) {
      // Preserve malformed JSON for repair; a remote publication can recover
      // the terminal. File-system/programming errors still reach the caller.
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  const publicationTime = (state: StoredState) => Date.parse(state.updatedAt || state.snapshot?.generatedAt || "") || 0;
  function newest(remote: StoredState | null): { state: StoredState; persistence: "github" | "local" | "unavailable" } {
    if (local?.snapshot && (!remote || publicationTime(local) > publicationTime(remote))) return { state: local, persistence: "local" };
    if (remote) return { state: remote, persistence: "github" };
    return { state: emptyState(), persistence: "unavailable" };
  }
  if (cached && cached.expires > Date.now()) return newest(cached.value);
  try {
    // Share a bounded minute key across readers: raw branch URLs otherwise retain
    // an older publication in GitHub's five-minute CDN cache after a successful push.
    const minute = Math.floor(Date.now() / 60_000);
    const response = await fetch(`https://raw.githubusercontent.com/${repo}/market-data/state.json?minute=${minute}`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
    if (!response.ok) throw new Error("Published state unavailable");
    const state = await response.json() as unknown;
    if (!isPublishedState(state)) throw new Error("Invalid published state");
    cached = { value: state, expires: Date.now() + 60_000 };
    return newest(state);
  } catch {
    return newest(cached?.value ?? null);
  }
}
