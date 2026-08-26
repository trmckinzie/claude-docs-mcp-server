import { describe, expect, it } from "vitest";
import { appendEntry, summarizeChanges } from "../../src/fetch/changelog.js";
import type { ChangelogEntry } from "../../src/fetch/changelog.js";

function entry(overrides: Partial<ChangelogEntry> = {}): ChangelogEntry {
  return {
    fetchedAt: "2026-08-01T00:00:00.000Z",
    added: [],
    updated: [],
    gone: [],
    ...overrides,
  };
}

describe("appendEntry", () => {
  it("adds the first entry to an empty history", () => {
    const result = appendEntry([], entry(), 20);
    expect(result).toEqual([entry()]);
  });

  it("appends after existing history, oldest first", () => {
    const first = entry({ fetchedAt: "2026-08-01T00:00:00.000Z" });
    const second = entry({ fetchedAt: "2026-08-10T00:00:00.000Z" });
    expect(appendEntry([first], second, 20)).toEqual([first, second]);
  });

  it("drops the oldest entry once the cap is exceeded", () => {
    const a = entry({ fetchedAt: "a" });
    const b = entry({ fetchedAt: "b" });
    const c = entry({ fetchedAt: "c" });
    expect(appendEntry([a, b], c, 2)).toEqual([b, c]);
  });

  it("keeps exactly `max` entries when appending lands right on the boundary", () => {
    const a = entry({ fetchedAt: "a" });
    const b = entry({ fetchedAt: "b" });
    expect(appendEntry([a], b, 2)).toEqual([a, b]);
  });
});

describe("summarizeChanges", () => {
  it("reports an explicit message when there is no history at all", () => {
    expect(summarizeChanges([], 5)).toBe("No changes recorded yet.");
  });

  it("formats a single entry with all three lists populated", () => {
    const text = summarizeChanges(
      [entry({ fetchedAt: "2026-08-24T00:00:00.000Z", added: ["a.md"], updated: ["b.md"], gone: ["c.md"] })],
      5,
    );
    expect(text).toContain("2026-08-24T00:00:00.000Z");
    expect(text).toContain("added: a.md");
    expect(text).toContain("updated: b.md");
    expect(text).toContain("gone: c.md");
  });

  it("omits a list category with nothing in it", () => {
    const text = summarizeChanges([entry({ added: ["a.md"] })], 5);
    expect(text).not.toContain("updated:");
    expect(text).not.toContain("gone:");
  });

  it("shows the most recent entries first", () => {
    const older = entry({ fetchedAt: "2026-08-01T00:00:00.000Z", added: ["old.md"] });
    const newer = entry({ fetchedAt: "2026-08-24T00:00:00.000Z", added: ["new.md"] });
    const text = summarizeChanges([older, newer], 5);
    expect(text.indexOf("new.md")).toBeLessThan(text.indexOf("old.md"));
  });

  it("respects the limit, taking only the most recent entries", () => {
    const a = entry({ fetchedAt: "a", added: ["a.md"] });
    const b = entry({ fetchedAt: "b", added: ["b.md"] });
    const c = entry({ fetchedAt: "c", added: ["c.md"] });
    const text = summarizeChanges([a, b, c], 2);
    expect(text).not.toContain("a.md");
    expect(text).toContain("b.md");
    expect(text).toContain("c.md");
  });

  it("omits a no-op fetch (nothing added, updated, or gone) from the output", () => {
    const noop = entry({ fetchedAt: "2026-08-10T00:00:00.000Z" });
    const real = entry({ fetchedAt: "2026-08-24T00:00:00.000Z", added: ["a.md"] });
    const text = summarizeChanges([noop, real], 5);
    expect(text).not.toContain("2026-08-10T00:00:00.000Z");
    expect(text).toContain("2026-08-24T00:00:00.000Z");
  });

  it("reports the explicit no-changes message when every entry in scope was a no-op", () => {
    const text = summarizeChanges([entry(), entry()], 5);
    expect(text).toBe("No changes recorded yet.");
  });
});
