import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPaperAccount } from "../lib/paper";

function deviceStorage(initial: unknown = null) {
  const fallback = new Map<string, string>();
  const fixture = { record: initial, fallback, failWrites: false, failReads: false, failFallbackReads: false, failFallbackWrites: false, failFallbackRemoval: false, onWrite: null as ((value: unknown) => void) | null };
  const database = {
    transaction(_name: string, mode: string) {
      if (mode === "readonly") return { objectStore: () => ({ get: () => {
        const request = { result: fixture.record, error: new Error("Device read failed"), onsuccess: () => {}, onerror: () => {} };
        queueMicrotask(() => fixture.failReads ? request.onerror() : request.onsuccess());
        return request;
      } }) };
      const transaction = { error: new Error("Device write failed"), oncomplete: () => {}, onerror: () => {}, onabort: () => {}, objectStore: () => ({ put: (value: unknown) => {
        fixture.onWrite?.(value);
        queueMicrotask(() => {
          if (fixture.failWrites) transaction.onerror();
          else { fixture.record = structuredClone(value); transaction.oncomplete(); }
        });
      } }) };
      return transaction;
    },
  };
  vi.stubGlobal("indexedDB", { open: () => {
    const request = { result: database, onsuccess: () => {} };
    queueMicrotask(() => request.onsuccess());
    return request;
  } });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => { if (fixture.failFallbackReads) throw new Error("Fallback read denied"); return fallback.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (fixture.failFallbackWrites) throw new Error("Fallback write failed"); fallback.set(key, value); },
    removeItem: (key: string) => { if (fixture.failFallbackRemoval) throw new Error("Fallback cleanup denied"); return fallback.delete(key); },
  });
  return fixture;
}

const saved = (capital: number, revision: number) => ({ storageVersion: 1, revision, account: createPaperAccount(capital) });
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("local portfolio recovery", () => {
  it("restores a newer fallback after a transient IndexedDB write failure", async () => {
    const device = deviceStorage(createPaperAccount(10000));
    const store = await import("../lib/local-store");
    device.failWrites = true;
    await store.saveLocalPortfolio(createPaperAccount(20000));
    device.failWrites = false;
    expect((await store.readLocalPortfolio())?.cash).toBe(20000);
  });

  it("recovers a valid fallback when the IndexedDB account is invalid", async () => {
    const device = deviceStorage({ version: 1, cash: "corrupt" });
    device.fallback.set("cix-paper", JSON.stringify(createPaperAccount(20000)));
    const { readLocalPortfolio } = await import("../lib/local-store");
    expect((await readLocalPortfolio())?.cash).toBe(20000);
    expect(device.record).toEqual({ version: 1, cash: "corrupt" });
  });

  it("uses the latest valid revision and keeps legacy raw account saves readable", async () => {
    const device = deviceStorage(saved(20000, 200));
    device.fallback.set("cix-paper", JSON.stringify(saved(10000, 100)));
    const { readLocalPortfolio } = await import("../lib/local-store");
    expect((await readLocalPortfolio())?.cash).toBe(20000);
    device.record = createPaperAccount(10000);
    device.fallback.set("cix-paper", JSON.stringify(createPaperAccount(15000)));
    expect((await readLocalPortfolio())?.cash).toBe(15000);
    device.fallback.delete("cix-paper");
    expect((await readLocalPortfolio())?.cash).toBe(10000);
  });

  it.each([0, 1])("keeps a fallback with revision offset %i while an IndexedDB save finishes", async (offset) => {
    const device = deviceStorage();
    device.onWrite = (value: unknown) => {
      const revision = (value as { revision: number }).revision;
      device.fallback.set("cix-paper", JSON.stringify(saved(20000, revision + offset)));
    };
    const store = await import("../lib/local-store");
    await store.saveLocalPortfolio(createPaperAccount(10000));
    expect((await store.readLocalPortfolio())?.cash).toBe(20000);
  });

  it.each(["read", "cleanup"])("keeps a successful primary save successful when fallback %s is denied", async (denied) => {
    const device = deviceStorage(createPaperAccount(10000));
    const backup = JSON.stringify(createPaperAccount(10000));
    device.fallback.set("cix-paper", backup);
    device.failFallbackReads = denied === "read";
    device.failFallbackRemoval = denied === "cleanup";
    device.failFallbackWrites = true;
    const store = await import("../lib/local-store");
    await expect(store.saveLocalPortfolio(createPaperAccount(20000))).resolves.toBeUndefined();
    expect((await store.readLocalPortfolio())?.cash).toBe(20000);
    expect(device.fallback.get("cix-paper")).toBe(backup);
  });

  it("preserves both prior copies if neither store can accept a save", async () => {
    const original = saved(10000, 100), backup = JSON.stringify(saved(20000, 200));
    const device = deviceStorage(original);
    device.fallback.set("cix-paper", backup);
    device.failWrites = true;
    device.failFallbackWrites = true;
    const { saveLocalPortfolio } = await import("../lib/local-store");
    await expect(saveLocalPortfolio(createPaperAccount(30000))).rejects.toThrow(/write failed/i);
    expect(device.record).toEqual(original);
    expect(device.fallback.get("cix-paper")).toBe(backup);
  });

  it("preserves invalid copies and rejects recovery when neither copy is valid", async () => {
    const original = { version: 1, cash: "corrupt" }, backup = "broken-json";
    const device = deviceStorage(original);
    device.fallback.set("cix-paper", backup);
    const { readLocalPortfolio } = await import("../lib/local-store");
    await expect(readLocalPortfolio()).rejects.toThrow();
    expect(device.record).toEqual(original);
    expect(device.fallback.get("cix-paper")).toBe(backup);
  });
});
