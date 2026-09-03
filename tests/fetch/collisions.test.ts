import { describe, expect, it } from "vitest";
import { findDuplicatePaths } from "../../src/fetch/collisions.js";

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
