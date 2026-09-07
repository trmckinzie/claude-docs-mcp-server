import { describe, expect, it } from "vitest";
import { carryForwardEntries, computeContentHash, diffManifest } from "../../src/fetch/manifest.js";
import type { ManifestEntry } from "../../src/fetch/manifest.js";

function entry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    path: "claude-code/overview.md",
    sourceUrl: "https://code.claude.com/docs/en/overview",
    sourceSite: "code",
    fetchedAt: "2026-08-01T00:00:00.000Z",
    contentHash: "hash-a",
    ...overrides,
  };
}

describe("computeContentHash", () => {
  it("changes when the title changes, even if the body doesn't", () => {
    // A source page can be retitled without its prose changing (a common
    // doc-maintenance edit). If the hash only covered the body, that edit
    // would be classified "unchanged" and the stale title would never be
    // rewritten to disk -- see scripts/fetch-docs.ts's use of this hash.
    const a = computeContentHash("Old Title", "Same body text.");
    const b = computeContentHash("New Title", "Same body text.");
    expect(a).not.toBe(b);
  });

  it("changes when the body changes, even if the title doesn't", () => {
    const a = computeContentHash("Title", "Old body.");
    const b = computeContentHash("Title", "New body.");
    expect(a).not.toBe(b);
  });

  it("is deterministic for the same title and body", () => {
    expect(computeContentHash("T", "B")).toBe(computeContentHash("T", "B"));
  });

  it("does not collide when title/body content shifts across the boundary", () => {
    // A naive `title + body` concatenation would hash ("AB", "C") the same
    // as ("A", "BC"). The hash must not do that.
    const a = computeContentHash("AB", "C");
    const b = computeContentHash("A", "BC");
    expect(a).not.toBe(b);
  });
});

describe("diffManifest", () => {
  it("reports a brand-new path as added, on a first run with no previous manifest", () => {
    const result = diffManifest([], [entry()]);
    expect(result.added).toEqual(["claude-code/overview.md"]);
    expect(result.updated).toEqual([]);
    expect(result.unchanged).toEqual([]);
    expect(result.gone).toEqual([]);
    expect(result.manifest).toEqual([entry()]);
  });

  it("reports unchanged when the hash matches the previous manifest", () => {
    const previous = [entry()];
    const fresh = [entry({ fetchedAt: "2026-08-24T00:00:00.000Z" })];
    const result = diffManifest(previous, fresh);
    expect(result.unchanged).toEqual(["claude-code/overview.md"]);
    expect(result.added).toEqual([]);
    expect(result.updated).toEqual([]);
    // Unchanged content keeps the OLD fetchedAt -- re-stamping it would make
    // every doc look freshly fetched even when nothing was actually re-read.
    expect(result.manifest[0]?.fetchedAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("reports updated when the hash differs, and keeps the new fetchedAt", () => {
    const previous = [entry({ contentHash: "hash-a" })];
    const fresh = [entry({ contentHash: "hash-b", fetchedAt: "2026-08-24T00:00:00.000Z" })];
    const result = diffManifest(previous, fresh);
    expect(result.updated).toEqual(["claude-code/overview.md"]);
    expect(result.unchanged).toEqual([]);
    expect(result.manifest[0]).toEqual(entry({ contentHash: "hash-b", fetchedAt: "2026-08-24T00:00:00.000Z" }));
  });

  it("reports gone for a path in the previous manifest but absent from the fresh fetch", () => {
    const previous = [entry(), entry({ path: "cowork/getting-started.md" })];
    const fresh = [entry()];
    const result = diffManifest(previous, fresh);
    expect(result.gone).toEqual(["cowork/getting-started.md"]);
    // A gone entry does not appear in the manifest going forward.
    expect(result.manifest.map((e) => e.path)).toEqual(["claude-code/overview.md"]);
  });

  it("handles a mix of added, updated, unchanged, and gone in one run", () => {
    const previous = [
      entry({ path: "a.md", contentHash: "1" }),
      entry({ path: "b.md", contentHash: "1" }),
      entry({ path: "c.md", contentHash: "1" }),
    ];
    const fresh = [
      entry({ path: "a.md", contentHash: "1" }), // unchanged
      entry({ path: "b.md", contentHash: "2" }), // updated
      entry({ path: "d.md", contentHash: "1" }), // added; c.md is gone
    ];
    const result = diffManifest(previous, fresh);
    expect(result.added).toEqual(["d.md"]);
    expect(result.updated).toEqual(["b.md"]);
    expect(result.unchanged).toEqual(["a.md"]);
    expect(result.gone).toEqual(["c.md"]);
  });

  it("treats an empty fresh fetch as everything gone, not an error", () => {
    const previous = [entry()];
    const result = diffManifest(previous, []);
    expect(result.gone).toEqual(["claude-code/overview.md"]);
    expect(result.manifest).toEqual([]);
  });

  it("is order-independent and reports lists sorted by path", () => {
    const previous = [entry({ path: "z.md" }), entry({ path: "a.md" })];
    const fresh = [entry({ path: "z.md" }), entry({ path: "a.md" }), entry({ path: "m.md" })];
    const result = diffManifest(previous, fresh);
    expect(result.added).toEqual(["m.md"]);
    expect(result.unchanged).toEqual(["a.md", "z.md"]);
    expect(result.manifest.map((e) => e.path)).toEqual(["a.md", "m.md", "z.md"]);
  });
});

/**
 * A per-article fetch that fails must not read as a deletion. Without this,
 * a transient 500 on one Help Center article drops it from the fresh set,
 * `diffManifest` calls it `gone`, and the pruner deletes real content off
 * disk over a network blip. Carrying the previous entry forward keeps the
 * path in the manifest, so it is neither rewritten nor removed.
 */
describe("carryForwardEntries", () => {
  it("restores a previous entry for a path that failed to fetch", () => {
    const previous = [entry({ path: "cowork/a.md", contentHash: "old" })];
    const result = carryForwardEntries([], previous, ["cowork/a.md"]);
    expect(result).toEqual(previous);
  });

  it("keeps the fresh entry when the path was fetched successfully", () => {
    const previous = [entry({ path: "a.md", contentHash: "old" })];
    const fresh = [entry({ path: "a.md", contentHash: "new" })];
    // Not in the failed list, so the fresh fetch wins.
    expect(carryForwardEntries(fresh, previous, [])).toEqual(fresh);
  });

  it("never lets a carried-forward entry shadow a fresh one", () => {
    const previous = [entry({ path: "a.md", contentHash: "old" })];
    const fresh = [entry({ path: "a.md", contentHash: "new" })];
    const result = carryForwardEntries(fresh, previous, ["a.md"]);
    expect(result).toHaveLength(1);
    expect(result[0]?.contentHash).toBe("new");
  });

  it("skips a failed path with no previous entry to fall back on", () => {
    // A brand-new article that failed on its first fetch: nothing to preserve.
    expect(carryForwardEntries([], [], ["cowork/new.md"])).toEqual([]);
  });

  it("returns the fresh set untouched when nothing failed", () => {
    const fresh = [entry({ path: "a.md" })];
    expect(carryForwardEntries(fresh, [entry({ path: "b.md" })], [])).toEqual(fresh);
  });
});
