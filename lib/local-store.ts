import { importPaperAccount, type PaperAccount } from "./paper";
let database: Promise<IDBDatabase> | null = null;
let writes: Promise<void> = Promise.resolve();
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
  let raw: unknown;
  try {
    const db = await openDatabase();
    raw = await new Promise((resolve, reject) => { const request = db.transaction("portfolio", "readonly").objectStore("portfolio").get("account"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  } catch { raw = localStorage.getItem("cix-paper"); }
  if (raw == null) raw = localStorage.getItem("cix-paper");
  if (raw == null) return null;
  return importPaperAccount(typeof raw === "string" ? raw : JSON.stringify(raw));
}
export function saveLocalPortfolio(account: PaperAccount): Promise<void> {
  const save = async () => {
    try {
      const db = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("portfolio", "readwrite");
        transaction.objectStore("portfolio").put(account, "account");
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error("Portfolio write aborted"));
      });
      localStorage.removeItem("cix-paper");
    } catch { localStorage.setItem("cix-paper", JSON.stringify(account)); }
  };
  const operation = writes.then(save, save);
  writes = operation.catch(() => undefined);
  return operation;
}
