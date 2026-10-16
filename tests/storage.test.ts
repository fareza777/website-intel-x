import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredState } from "../lib/types";

const { localRead, localWrite, localRename } = vi.hoisted(() => ({ localRead: vi.fn(), localWrite: vi.fn(), localRename: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: localRead, mkdir: vi.fn(), rename: localRename, writeFile: localWrite }));

function state(at: string): StoredState {
  return { version: 1, updatedAt: at, signals: [], alerts: [], analytics: null, snapshot: { version: 1, generatedAt: at, dataAsOf: at, status: "live", source: "test fixture", universeSize: 0, scanned: 0, setups: [], errors: [], durationMs: 0, costs: { feeBps: 10, slippageBps: 5 } } };
}

beforeEach(() => { vi.resetModules(); vi.stubEnv("VERCEL", ""); localRead.mockReset(); localWrite.mockReset(); localRename.mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("local terminals receive scheduled publications", () => {
  it("prefers a newer GitHub publication over an old local seed", async () => {
    localRead.mockResolvedValue(JSON.stringify(state("2026-10-15T13:21:00Z")));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(state("2026-10-15T14:17:00Z"))));
    const { readPublishedState } = await import("../lib/storage");
    const result = await readPublishedState();
    expect(result.persistence).toBe("github");
    expect(result.state.updatedAt).toBe("2026-10-15T14:17:00Z");
  });
  it("preserves a newer trusted local scan", async () => {
    localRead.mockResolvedValue(JSON.stringify(state("2026-10-15T14:20:00Z")));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(state("2026-10-15T14:17:00Z"))));
    const { readPublishedState } = await import("../lib/storage");
    expect((await readPublishedState()).persistence).toBe("local");
  });
  it("retains local data when the public history is unavailable", async () => {
    localRead.mockResolvedValue(JSON.stringify(state("2026-10-15T13:21:00Z")));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { readPublishedState } = await import("../lib/storage");
    expect((await readPublishedState()).persistence).toBe("local");
  });
  it.each(["{malformed", '{"version":1,"updatedAt":"2099-01-01T00:00:00Z","snapshot":{"setups":[]}}'])("recovers malformed local state from GitHub without changing the local file", async (original) => {
    localRead.mockResolvedValue(original);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(state("2026-10-15T14:17:00Z"))));
    const { readPublishedState } = await import("../lib/storage");
    const recovered = await readPublishedState();
    expect(recovered.persistence).toBe("github");
    expect(recovered.state.updatedAt).toBe("2026-10-15T14:17:00Z");
    expect(localWrite).not.toHaveBeenCalled();
    expect(localRename).not.toHaveBeenCalled();
  });
  it.each(["{malformed", '{"version":1,"updatedAt":"2099-01-01T00:00:00Z","snapshot":{"setups":[]}}'])("returns unavailable when malformed local state has no valid remote recovery", async (original) => {
    localRead.mockResolvedValue(original);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { readPublishedState } = await import("../lib/storage");
    const recovered = await readPublishedState();
    expect(recovered.persistence).toBe("unavailable");
    expect(recovered.state.snapshot).toBeNull();
    expect(recovered.state.signals).toEqual([]);
    expect(localWrite).not.toHaveBeenCalled();
    expect(localRename).not.toHaveBeenCalled();
  });
  it("propagates unrelated local reader programming errors", async () => {
    localRead.mockRejectedValue(new TypeError("Unexpected reader failure"));
    const { readPublishedState } = await import("../lib/storage");
    await expect(readPublishedState()).rejects.toThrow("Unexpected reader failure");
  });
  it("avoids an older raw-branch CDN response and shares one fetch across repeated reads", async () => {
    localRead.mockResolvedValue(JSON.stringify(state("2026-10-15T13:21:00Z")));
    const request = vi.fn(async (url: string) => Response.json(state(new URL(url).searchParams.has("minute") ? "2026-10-15T14:17:00Z" : "2026-10-15T13:21:00Z")));
    vi.stubGlobal("fetch", request);
    const { readPublishedState } = await import("../lib/storage");
    expect((await readPublishedState()).state.updatedAt).toBe("2026-10-15T14:17:00Z");
    await readPublishedState();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
