import { describe, expect, it } from "vitest";
import { diffManifest } from "../../src/fetch/manifest.js";
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
