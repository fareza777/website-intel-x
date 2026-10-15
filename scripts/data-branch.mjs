import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BRANCH = "refs/heads/market-data";
const ROOT_FILES = new Set(["state.json", "analytics.json", "analytics-attempt.json", "scanner-validation.json", "scan-report.json", "alert-delivery.json"]);
const ARCHIVE = /^archives\/(originals|outcomes)\/\d{4}-\d{2}\.jsonl$/;
const managed = (name) => ROOT_FILES.has(name) || ARCHIVE.test(name);

function git(cwd, args, options = {}) {
  try { return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...options }); }
  catch { throw new Error("Git data-branch operation failed. Check repository access and concurrency; credentials and raw Git errors are not logged."); }
}

async function locations(options) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const root = path.resolve(git(cwd, ["rev-parse", "--show-toplevel"]).trim());
  const directory = path.resolve(options.directory ?? process.env.DATA_DIRECTORY ?? path.join(root, "data"));
  if (directory === root || directory === path.join(root, ".git") || directory.startsWith(`${path.join(root, ".git")}${path.sep}`)) throw new Error("DATA_DIRECTORY must be a separate data directory");
  await mkdir(directory, { recursive: true });
  return { cwd: root, directory, remote: options.remote ?? "origin" };
}

async function optional(file) {
  try { return await readFile(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function atomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, value, "utf8");
  await rename(temporary, file);
}

function remoteTip(cwd, remote) {
  let listed;
  try { listed = execFileSync("git", ["ls-remote", "--exit-code", "--heads", remote, BRANCH], { cwd, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (error) { if (error.status === 2) return null; throw new Error("Cannot inspect the market-data branch. Check Git access; no history was replaced."); }
  if (!listed.trim()) return null;
  git(cwd, ["fetch", "--no-tags", remote, BRANCH]);
  return git(cwd, ["rev-parse", "FETCH_HEAD"]).trim();
}

function entries(cwd, tip) {
  if (!tip) return [];
  return git(cwd, ["ls-tree", "-r", "-z", tip]).split("\0").filter(Boolean).flatMap((line) => {
    const [metadata, name] = line.split("\t");
    if (!managed(name)) return [];
    const [mode, type] = metadata.split(" ");
    if (mode !== "100644" || type !== "blob") throw new Error("Managed data branch paths must be plain files, never symlinks");
    return [name];
  });
}

function mergeArchive(remote, local) {
  const lines = remote.split("\n").filter(Boolean);
  const known = new Map();
  for (const line of lines) {
    const record = JSON.parse(line);
    if (typeof record.id !== "string" || known.has(record.id)) throw new Error("Invalid or duplicate remote archive ids");
    known.set(record.id, line);
  }
  const appended = [];
  for (const line of local.split("\n").filter(Boolean)) {
    const record = JSON.parse(line);
    if (typeof record.id !== "string") throw new Error("Invalid local archive id");
    const existing = known.get(record.id);
    if (existing && existing !== line) throw new Error("Immutable archive id collision; history was preserved");
    if (!existing) { appended.push(line); known.set(record.id, line); }
  }
  return appended.length ? `${remote}${remote && !remote.endsWith("\n") ? "\n" : ""}${appended.join("\n")}\n` : remote;
}

/** Restore public branch files into ignored local data; source HEAD and index are untouched. */
export async function restoreData(options = {}) {
  const { cwd, directory, remote } = await locations(options);
  const tip = remoteTip(cwd, remote);
  const files = entries(cwd, tip);
  for (const name of files) {
    const remoteContent = git(cwd, ["show", `${tip}:${name}`]);
    const destination = path.join(directory, ...name.split("/"));
    const local = ARCHIVE.test(name) ? await optional(destination) : null;
    await atomic(destination, local === null ? remoteContent : mergeArchive(remoteContent, local));
  }
  await atomic(path.join(directory, ".branch-base.json"), JSON.stringify({ version: 1, remoteTip: tip, restoredAt: new Date().toISOString() }));
  return { restored: files.length, remoteTip: tip };
}

async function localFiles(directory, relative = "") {
  const result = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory() && ["archives", "archives/originals", "archives/outcomes"].includes(name)) result.push(...await localFiles(directory, name));
    else if (managed(name)) {
      if (!entry.isFile()) throw new Error("Managed local data paths must be plain files");
      if ((await stat(path.join(directory, ...name.split("/")))).size > 50 * 1024 * 1024) throw new Error("A data file exceeded the bounded publication size; preserve it and review archive growth");
      result.push(name);
    }
  }
  return result.sort();
}

/** Build with a temporary Git index; push a normal fast-forward without checking out a branch. */
export async function publishData(options = {}) {
  const { cwd, directory, remote } = await locations(options);
  const baseText = await optional(path.join(directory, ".branch-base.json"));
  if (!baseText) throw new Error("Restore the data branch before publication");
  const base = JSON.parse(baseText);
  if (base.version !== 1 || base.remoteTip !== null && !/^[0-9a-f]{40,64}$/.test(base.remoteTip)) throw new Error("Invalid restored data branch base");
  const tip = remoteTip(cwd, remote);
  if (tip !== base.remoteTip) throw new Error("The remote data branch advanced. Restore and rerun the publisher; concurrent history was preserved.");
  const files = await localFiles(directory);
  if (!files.includes("state.json")) throw new Error("No diagnostic state.json exists to publish");
  const remoteFiles = entries(cwd, tip);
  for (const name of remoteFiles.filter((name) => ARCHIVE.test(name) && files.includes(name))) {
    const prior = git(cwd, ["show", `${tip}:${name}`]);
    const current = await readFile(path.join(directory, ...name.split("/")), "utf8");
    if (!current.startsWith(prior)) throw new Error("Archives are append-only; refusing to rewrite or drop original history");
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), "crypto-market-index-"));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: path.join(temporary, "index"), GIT_AUTHOR_NAME: "CryptoIntel market publisher", GIT_AUTHOR_EMAIL: "market-publisher@users.noreply.github.com", GIT_COMMITTER_NAME: "CryptoIntel market publisher", GIT_COMMITTER_EMAIL: "market-publisher@users.noreply.github.com" };
    git(cwd, tip ? ["read-tree", tip] : ["read-tree", "--empty"], { env });
    for (const name of files) {
      const blob = git(cwd, ["hash-object", "-w", "--stdin"], { env, input: await readFile(path.join(directory, ...name.split("/"))) }).trim();
      git(cwd, ["update-index", "--add", "--cacheinfo", "100644", blob, name], { env });
    }
    const tree = git(cwd, ["write-tree"], { env }).trim();
    if (tip && git(cwd, ["rev-parse", `${tip}^{tree}`]).trim() === tree) return { changed: false, commit: tip };
    const commit = git(cwd, ["commit-tree", tree, ...(tip ? ["-p", tip] : []), "-m", `Market state ${new Date().toISOString()}`], { env }).trim();
    git(cwd, ["push", remote, `${commit}:${BRANCH}`]);
    await atomic(path.join(directory, ".branch-base.json"), JSON.stringify({ version: 1, remoteTip: commit, restoredAt: new Date().toISOString() }));
    return { changed: true, commit };
  } finally {
    if (path.dirname(temporary) !== path.resolve(os.tmpdir()) || !path.basename(temporary).startsWith("crypto-market-index-")) throw new Error("Unsafe temporary index cleanup path");
    await rm(temporary, { recursive: true, force: true });
  }
}

export function analyticsDue(generatedAt, attemptedAt, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const day = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0, 10) : null;
  return day(generatedAt) !== today && day(attemptedAt) !== today;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (args.some((argument) => argument !== "--force")) throw new Error("Unknown data-branch argument");
  if (command === "restore") console.log(JSON.stringify(await restoreData()));
  else if (command === "publish") console.log(JSON.stringify(await publishData()));
  else if (command === "analytics-due") {
    const directory = path.resolve(process.env.DATA_DIRECTORY ?? "data");
    const reportText = await optional(path.join(directory, "analytics.json"));
    const attemptText = await optional(path.join(directory, "analytics-attempt.json"));
    const report = reportText ? JSON.parse(reportText) : null;
    const attempt = attemptText ? JSON.parse(attemptText) : null;
    const due = args.includes("--force") || analyticsDue(report?.generatedAt, attempt?.attemptedAt);
    if (due) await atomic(path.join(directory, "analytics-attempt.json"), JSON.stringify({ version: 1, attemptedAt: new Date().toISOString() }));
    if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `due=${due}\n`, { flag: "a" });
    console.log(JSON.stringify({ due }));
  } else throw new Error("Usage: node scripts/data-branch.mjs restore|publish|analytics-due [--force]");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
