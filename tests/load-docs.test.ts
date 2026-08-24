import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDoc } from "../src/parse-doc.js";
import { loadDocs } from "../src/load-docs.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

describe("loadDocs", () => {
  it("parses every Markdown file under a directory, sorted by path", async () => {
    const docs = await loadDocs(`${FIXTURES}corpus`);
    expect(docs.map((d) => d.path)).toEqual([
      "api/messages.md",
      "claude-code/settings.md",
      "mcp/transports.md",
    ]);
  });

  it("produces the same result parseDoc would, given the same raw text", async () => {
    const docs = await loadDocs(`${FIXTURES}corpus`);
    const transports = docs.find((d) => d.path === "mcp/transports.md");
    const raw = await readFile(`${FIXTURES}corpus/mcp/transports.md`, "utf8");
    expect(transports).toEqual(parseDoc(raw, "mcp/transports.md"));
  });

  it("does not throw on the parser edge cases", async () => {
    const docs = await loadDocs(`${FIXTURES}edge-cases`);
    expect(docs).toHaveLength(5);
  });

  it("returns an empty list for a directory that does not exist, rather than throwing", async () => {
    // docs/ is gitignored and only populated by the fetch step (2.6.5), so a
    // fresh clone must start the server without it.
    await expect(loadDocs(`${FIXTURES}does-not-exist`)).resolves.toEqual([]);
  });

  it("ignores non-Markdown files", async () => {
    const docs = await loadDocs(FIXTURES);
    for (const doc of docs) {
      expect(doc.path.endsWith(".md")).toBe(true);
    }
    expect(docs.some((d) => d.path.endsWith("load.ts"))).toBe(false);
  });
});
