import { readdir } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// Phase 1 only: proves the toolchain runs before any implementation exists.
// Deleted at PLAN.md step 2.0, once real fixtures replace it.
describe("toolchain", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });

  it("resolves ESM + node: builtins from a test file", async () => {
    const projectRoot = new URL("..", import.meta.url);
    const entries = await readdir(projectRoot);
    expect(entries).toContain("docs");
    expect(entries).toContain("src");
  });
});
