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
export async function readPublishedState(): Promise<{ state: StoredState; persistence: "github" | "local" | "unavailable" }> {
  if (!process.env.VERCEL) {
    const state = await readLocalState();
    if (state.snapshot) return { state, persistence: "local" };
  }
  if (cached && cached.expires > Date.now()) return { state: cached.value, persistence: "github" };
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${repo}/market-data/state.json`, { signal: AbortSignal.timeout(12_000), next: { revalidate: 60 } });
    if (!response.ok) throw new Error("Published state unavailable");
    const state = await response.json() as StoredState;
    if (state.version !== 1 || !Array.isArray(state.signals) || !Array.isArray(state.snapshot?.setups)) throw new Error("Invalid published state");
    cached = { value: state, expires: Date.now() + 60_000 };
    return { state, persistence: "github" };
  } catch {
    if (cached) return { state: cached.value, persistence: "github" };
    return { state: emptyState(), persistence: "unavailable" };
  }
}
