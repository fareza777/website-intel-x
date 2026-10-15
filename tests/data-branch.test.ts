import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyticsDue, publishData, restoreData } from "../scripts/data-branch.mjs";

const directories: string[] = [];
function git(cwd: string, ...args: string[]) { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "crypto-data-branch-test-")); directories.push(root);
  const remote = path.join(root, "remote.git"); const cwd = path.join(root, "work"); const directory = path.join(cwd, "data");
  await mkdir(cwd); git(root, "init", "--bare", remote); git(cwd, "init", "--initial-branch=main");
  git(cwd, "config", "user.name", "Fixture"); git(cwd, "config", "user.email", "fixture@example.test");
  await writeFile(path.join(cwd, "main.txt"), "source stays unchanged\n"); git(cwd, "add", "main.txt"); git(cwd, "commit", "-m", "Fixture source"); git(cwd, "remote", "add", "origin", remote);
  return { root, remote, cwd, directory };
}
afterEach(async () => { for (const value of directories.splice(0)) { if (path.dirname(value) !== path.resolve(os.tmpdir())) throw new Error("Unsafe fixture cleanup"); await rm(value, { recursive: true, force: true }); } });

describe("dedicated data branch", () => {
  it("creates an orphan data history while preserving the source HEAD and index", async () => {
    const f = await fixture(); const head = git(f.cwd, "rev-parse", "HEAD"); const tree = git(f.cwd, "write-tree");
    await restoreData(f);
    await writeFile(path.join(f.directory, "state.json"), '{"version":1}');
    await mkdir(path.join(f.directory, "archives/originals"), { recursive: true });
    await writeFile(path.join(f.directory, "archives/originals/2026-10.jsonl"), '{"id":"A"}\n');
    await writeFile(path.join(f.directory, "private.env"), "DO_NOT_PUBLISH=fixture\n");
    await writeFile(path.join(f.directory, "scanner-validation.json"), '{"version":1,"strategyVersion":"cx-spot-3"}');
    await mkdir(path.join(f.directory, "validation-candles"));
    await writeFile(path.join(f.directory, "validation-candles/BTCUSDT.json"), '{"raw":"must stay local"}');
    await publishData(f);
    expect(git(f.cwd, "rev-parse", "HEAD")).toBe(head); expect(git(f.cwd, "write-tree")).toBe(tree);
    expect(git(f.remote, "rev-list", "--max-parents=0", "market-data")).not.toBe(head);
    expect(git(f.remote, "show", "market-data:state.json")).toBe('{"version":1}');
    expect(git(f.remote, "ls-tree", "-r", "--name-only", "market-data")).not.toContain("private.env");
    expect(git(f.remote, "show", "market-data:scanner-validation.json")).toBe('{"version":1,"strategyVersion":"cx-spot-3"}');
    expect(git(f.remote, "ls-tree", "-r", "--name-only", "market-data")).not.toContain("validation-candles");
  }, 30_000);
  it("rejects archive rewriting and preserves every previously pushed archive", async () => {
    const f = await fixture(); await restoreData(f);
    await writeFile(path.join(f.directory, "state.json"), '{"version":1}');
    await mkdir(path.join(f.directory, "archives/originals"), { recursive: true });
    const archive = path.join(f.directory, "archives/originals/2026-10.jsonl");
    await writeFile(archive, '{"id":"A"}\n'); await publishData(f);
    await writeFile(archive, '{"id":"B"}\n');
    await expect(publishData(f)).rejects.toThrow(/append|immutable|archive/i);
    expect(git(f.remote, "show", "market-data:archives/originals/2026-10.jsonl")).toBe('{"id":"A"}');
    await restoreData(f);
    expect(await readFile(archive, "utf8")).toBe('{"id":"A"}\n{"id":"B"}\n');
    await publishData(f);
    expect(git(f.remote, "show", "market-data:archives/originals/2026-10.jsonl")).toBe('{"id":"A"}\n{"id":"B"}');
  }, 30_000);
  it("refuses a stale publisher instead of overwriting a newer remote state", async () => {
    const f = await fixture(); await restoreData(f); await writeFile(path.join(f.directory, "state.json"), '{"version":1}'); await publishData(f);
    const other = path.join(f.root, "other"); git(f.root, "clone", "--branch", "market-data", f.remote, other);
    git(other, "config", "user.name", "Fixture"); git(other, "config", "user.email", "fixture@example.test");
    await writeFile(path.join(other, "state.json"), '{"version":1,"newer":true}'); git(other, "add", "state.json"); git(other, "commit", "-m", "Other publisher"); git(other, "push", "origin", "market-data");
    await expect(publishData(f)).rejects.toThrow(/advanced|restore|concurrent/i);
    expect(git(f.remote, "show", "market-data:state.json")).toContain('"newer":true');
  }, 30_000);
  it("runs analytics once per UTC day even when the previous attempt failed", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    expect(analyticsDue(null, null, now)).toBe(true);
    expect(analyticsDue("2026-10-14T12:00:00Z", "2026-10-15T00:17:00Z", now)).toBe(false);
    expect(analyticsDue("2026-10-15T00:17:00Z", null, now)).toBe(false);
  });
});
