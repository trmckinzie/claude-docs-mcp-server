import { describe, expect, it } from "vitest";
import { selectOrphanedPaths, selectPathsToWrite } from "../../src/fetch/reconcile.js";

/**
 * The bug this module exists for: `docs.manifest.json` is committed while
 * `docs/` is gitignored, so a fresh clone starts with a full manifest and an
 * empty corpus. Selecting writes from `added`/`updated` alone wrote nothing at
 * all in that state -- the fetch reported "unchanged: 283" and exited 0 with
 * docs/ still empty.
 */
describe("selectPathsToWrite", () => {
  it("always writes added and updated paths", () => {
    const diff = { added: ["a.md"], updated: ["b.md"], unchanged: [] };
    expect(selectPathsToWrite(diff, new Set())).toEqual(["a.md", "b.md"]);
    // Present on disk or not, a changed page must be rewritten.
    expect(selectPathsToWrite(diff, new Set(["a.md", "b.md"]))).toEqual(["a.md", "b.md"]);
  });

  it("skips unchanged paths that are already on disk", () => {
    const diff = { added: [], updated: [], unchanged: ["a.md", "b.md"] };
    expect(selectPathsToWrite(diff, new Set(["a.md", "b.md"]))).toEqual([]);
  });

  it("writes an unchanged path whose file is missing", () => {
    const diff = { added: [], updated: [], unchanged: ["a.md", "b.md"] };
    expect(selectPathsToWrite(diff, new Set(["a.md"]))).toEqual(["b.md"]);
  });

  it("rebuilds the whole corpus on a fresh clone", () => {
    // Committed manifest, empty docs/: every path reads as unchanged.
    const paths = ["claude-code/mcp.md", "cowork/overview.md", "platform/skills.md"];
    const diff = { added: [], updated: [], unchanged: paths };
    expect(selectPathsToWrite(diff, new Set())).toEqual([...paths].sort());
  });

  it("returns a sorted, deduplicated list", () => {
    const diff = { added: ["z.md", "a.md"], updated: ["a.md"], unchanged: ["m.md"] };
    expect(selectPathsToWrite(diff, new Set())).toEqual(["a.md", "m.md", "z.md"]);
  });

  it("writes nothing for an empty diff", () => {
    expect(selectPathsToWrite({ added: [], updated: [], unchanged: [] }, new Set())).toEqual([]);
  });
});

/**
 * The other direction of the same reconciliation. Deleting only what the
 * manifest diff calls `gone` cannot heal a file the manifest has already
 * forgotten -- e.g. a run interrupted between writing the manifest and
 * pruning, which drops the path from the manifest while leaving it on disk.
 * It would then be absent from every future diff and served stale forever.
 * The fresh manifest is the whole truth about what belongs in `docs/`.
 */
describe("selectOrphanedPaths", () => {
  it("finds a file on disk that the manifest no longer lists", () => {
    expect(selectOrphanedPaths(["a.md"], ["a.md", "stale.md"])).toEqual(["stale.md"]);
  });

  it("returns nothing when disk and manifest agree", () => {
    expect(selectOrphanedPaths(["a.md", "b.md"], ["a.md", "b.md"])).toEqual([]);
  });

  it("ignores manifest paths that are not on disk", () => {
    // That case is selectPathsToWrite's job -- it means "restore", not "delete".
    expect(selectOrphanedPaths(["a.md", "b.md"], ["a.md"])).toEqual([]);
  });

  it("returns a sorted, deduplicated list", () => {
    expect(selectOrphanedPaths([], ["z.md", "a.md", "a.md"])).toEqual(["a.md", "z.md"]);
  });

  it("treats an empty manifest as making every file on disk an orphan", () => {
    expect(selectOrphanedPaths([], ["a.md"])).toEqual(["a.md"]);
  });
});
