import { describe, expect, it } from "vitest";
import { buildIndex } from "../src/build-index.js";
import { listDocuments, listSections } from "../src/list-docs.js";
import { parseDoc } from "../src/parse-doc.js";
import { loadFixtures } from "./fixtures/load.js";

async function corpusIndex() {
  const docs = await loadFixtures("corpus");
  return buildIndex(docs.map((d) => parseDoc(d.raw, d.path)));
}

describe("listSections", () => {
  it("lists the real corpus's sections with a doc count each", async () => {
    const index = await corpusIndex();
    // api/messages.md, claude-code/settings.md, mcp/transports.md -- one
    // document per section in this fixture set.
    expect(listSections(index)).toEqual([
      { section: "api", count: 1 },
      { section: "claude-code", count: 1 },
      { section: "mcp", count: 1 },
    ]);
  });

  it("counts distinct documents, not chunks", () => {
    const index = buildIndex([
      parseDoc("## Alpha\n\none\n\n## Beta\n\ntwo\n", "docs/multi-chunk.md"),
    ]);
    // Two headings split this into two chunks, but it's one document.
    expect(listSections(index)).toEqual([{ section: "docs", count: 1 }]);
  });

  it("returns an empty list for an empty index", () => {
    expect(listSections(buildIndex([]))).toEqual([]);
  });

  it("sorts sections by name", () => {
    const index = buildIndex([
      parseDoc("## Z\n\nx\n", "zulu/a.md"),
      parseDoc("## A\n\nx\n", "alpha/b.md"),
    ]);
    expect(listSections(index).map((s) => s.section)).toEqual(["alpha", "zulu"]);
  });
});

describe("listDocuments", () => {
  it("lists every document under a section, sorted by path", async () => {
    const index = await corpusIndex();
    expect(listDocuments(index, "mcp")).toEqual([
      { path: "mcp/transports.md", title: "MCP Transports" },
    ]);
  });

  it("lists a document exactly once even when it has multiple chunks", () => {
    const index = buildIndex([
      parseDoc("## Alpha\n\none\n\n## Beta\n\ntwo\n", "docs/multi-chunk.md"),
    ]);
    expect(listDocuments(index, "docs")).toHaveLength(1);
  });

  it("returns an empty list for a section that doesn't exist", async () => {
    const index = await corpusIndex();
    expect(listDocuments(index, "not-a-real-section")).toEqual([]);
  });

  it("sorts multiple documents in a section by path", () => {
    const index = buildIndex([
      parseDoc("## Z\n\nx\n", "docs/z.md"),
      parseDoc("## A\n\nx\n", "docs/a.md"),
    ]);
    expect(listDocuments(index, "docs").map((d) => d.path)).toEqual(["docs/a.md", "docs/z.md"]);
  });
});
