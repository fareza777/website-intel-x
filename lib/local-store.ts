import { importPaperAccount, type PaperAccount } from "./paper";
let database: Promise<IDBDatabase> | null = null;
let writes: Promise<void> = Promise.resolve();
let latestRevision = 0;
interface SavedPortfolio { storageVersion: 1; revision: number; account: PaperAccount }
function savedPortfolio(raw: unknown): SavedPortfolio {
  const value = typeof raw === "string" ? JSON.parse(raw) as unknown : raw;
  if (value && typeof value === "object" && "storageVersion" in value) {
    const saved = value as SavedPortfolio;
    if (saved.storageVersion !== 1 || !Number.isSafeInteger(saved.revision) || saved.revision <= 0) throw new Error("Invalid saved portfolio revision.");
    return { storageVersion: 1, revision: saved.revision, account: importPaperAccount(JSON.stringify(saved.account)) };
  }
  return { storageVersion: 1, revision: 0, account: importPaperAccount(JSON.stringify(value)) };
}
function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open("cryptointel-local", 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("portfolio")) request.result.createObjectStore("portfolio"); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
    request.onblocked = () => { database = null; reject(new Error("Local portfolio database is blocked by another tab.")); };
  });
  return database;
}
export async function readLocalPortfolio(): Promise<PaperAccount | null> {
  const copies: unknown[] = [];
  let fallbackError: unknown;
  try {
    const db = await openDatabase();
    copies.push(await new Promise((resolve, reject) => { const request = db.transaction("portfolio", "readonly").objectStore("portfolio").get("account"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }));
  } catch { /* A valid fallback can recover an unavailable device database. */ }
  try { copies.push(localStorage.getItem("cix-paper")); } catch (error) { fallbackError = error; }
  let newest: SavedPortfolio | null = null, invalid: unknown;
  for (const raw of copies) {
    if (raw == null) continue;
    try {
      const saved = savedPortfolio(raw);
      // Fallback wins revision ties. Legacy copies have revision zero; a
      // successful legacy database save removed its corresponding fallback.
      if (!newest || saved.revision >= newest.revision) newest = saved;
    } catch (error) { invalid = error; }
  }
  if (newest) { latestRevision = Math.max(latestRevision, newest.revision); return newest.account; }
  if (invalid) throw invalid;
  if (fallbackError) throw fallbackError;
  return null;
}
export function saveLocalPortfolio(account: PaperAccount): Promise<void> {
  latestRevision = Math.max(Date.now(), latestRevision + 1);
  const saved: SavedPortfolio = { storageVersion: 1, revision: latestRevision, account: structuredClone(account) };
  const save = async () => {
    try {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("portfolio", "readwrite");
        transaction.objectStore("portfolio").put(saved, "account");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("Portfolio write aborted"));
      });
      try {
        const raw = localStorage.getItem("cix-paper");
        if (raw !== null) {
          const fallback = savedPortfolio(raw);
          latestRevision = Math.max(latestRevision, fallback.revision);
          if (fallback.revision < saved.revision) localStorage.removeItem("cix-paper");
        }
      } catch { /* The primary save committed; optional fallback cleanup must not fail it. */ }
    } catch {
      const raw = localStorage.getItem("cix-paper");
      if (raw !== null) {
        try {
          const fallback = savedPortfolio(raw);
          latestRevision = Math.max(latestRevision, fallback.revision);
          if (fallback.revision >= saved.revision) return;
        } catch { /* An explicit recovery save may replace an invalid fallback. */ }
      }
      localStorage.setItem("cix-paper", JSON.stringify(saved));
    }
  };
  const operation = writes.then(save, save);
  writes = operation.catch(() => undefined);
  return operation;
}
