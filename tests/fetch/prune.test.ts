import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pruneGoneDocs } from "../../src/fetch/prune.js";

describe("pruneGoneDocs", () => {
  let docsRoot: string;

  beforeEach(async () => {
    docsRoot = await mkdtemp(`${tmpdir()}${sep}prune-test-`);
  });

  afterEach(async () => {
    await rm(docsRoot, { recursive: true, force: true });
  });

  it("deletes files named in gonePaths and leaves the rest untouched", async () => {
    await mkdir(join(docsRoot, "claude-code"), { recursive: true });
    await writeFile(join(docsRoot, "claude-code", "old.md"), "stale");
    await writeFile(join(docsRoot, "claude-code", "keep.md"), "fresh");

    const result = await pruneGoneDocs(docsRoot, ["claude-code/old.md"]);

    expect(result).toEqual({ deleted: ["claude-code/old.md"], skipped: [] });
    const remaining = await readdir(join(docsRoot, "claude-code"));
    expect(remaining).toEqual(["keep.md"]);
  });

  it("treats an already-missing file as successfully deleted", async () => {
    const result = await pruneGoneDocs(docsRoot, ["never-existed.md"]);
    expect(result).toEqual({ deleted: ["never-existed.md"], skipped: [] });
  });

  it("refuses a path that escapes docsRoot rather than deleting it", async () => {
    const result = await pruneGoneDocs(docsRoot, ["../outside.md"]);
    expect(result).toEqual({ deleted: [], skipped: ["../outside.md"] });
  });

  it("returns an empty result for no gone paths", async () => {
    expect(await pruneGoneDocs(docsRoot, [])).toEqual({ deleted: [], skipped: [] });
  });
});
