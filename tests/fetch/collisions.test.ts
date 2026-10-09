import { describe, expect, it } from "vitest";
import { dropIdenticalDuplicates, findDuplicatePaths } from "../../src/fetch/collisions.js";

describe("findDuplicatePaths", () => {
  it("returns an empty list when every path is unique", () => {
    expect(findDuplicatePaths(["a.md", "b.md", "c.md"])).toEqual([]);
  });

  it("returns a path that appears more than once, once", () => {
    expect(findDuplicatePaths(["a.md", "b.md", "a.md"])).toEqual(["a.md"]);
  });

  it("returns multiple collided paths, sorted", () => {
    expect(findDuplicatePaths(["z.md", "a.md", "z.md", "a.md"])).toEqual(["a.md", "z.md"]);
  });

  it("returns an empty list for an empty input", () => {
    expect(findDuplicatePaths([])).toEqual([]);
  });
});

describe("dropIdenticalDuplicates", () => {
  const doc = (path: string, sourceUrl: string, title: string, body: string) => ({ path, sourceUrl, title, body });

  // 2026-10-09: code.claude.com's llms-full.txt listed eight pages twice,
  // byte for byte. That is not two articles fighting over one path, and
  // refusing the whole refresh over it left the corpus a month stale.
  it("keeps one copy of a record repeated byte for byte", () => {
    const a = doc("x/a.md", "https://h/a", "A", "body");
    expect(dropIdenticalDuplicates([a, { ...a }])).toEqual([a]);
  });

  it("keeps both when the same path carries different content, so the collision check still fires", () => {
    const a = doc("x/a.md", "https://h/a", "A", "one");
    const b = doc("x/a.md", "https://h/a", "A", "two");
    const kept = dropIdenticalDuplicates([a, b]);
    expect(kept).toEqual([a, b]);
    expect(findDuplicatePaths(kept.map((d) => d.path))).toEqual(["x/a.md"]);
  });

  it("keeps both when two different sources reduce to one path", () => {
    const a = doc("x/a.md", "https://h/1-a", "A", "same");
    const b = doc("x/a.md", "https://h/2-a", "A", "same");
    expect(dropIdenticalDuplicates([a, b])).toHaveLength(2);
  });

  it("preserves order and leaves unique records alone", () => {
    const a = doc("a.md", "https://h/a", "A", "1");
    const b = doc("b.md", "https://h/b", "B", "2");
    expect(dropIdenticalDuplicates([a, b, { ...a }])).toEqual([a, b]);
  });
});
