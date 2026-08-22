import { describe, expect, it } from "vitest";
import { buildIndex, documentFrequency } from "../src/build-index.js";
import type { Index } from "../src/build-index.js";
import { parseDoc } from "../src/parse-doc.js";
import { loadFixtures } from "./fixtures/load.js";

/** Canonical serialisation, for asserting two builds are identical. */
function serialize(index: Index): string {
  return JSON.stringify({
    size: index.size,
    avgdl: index.avgdl,
    chunks: index.chunks.map((c) => [c.path, c.anchor, c.length]),
    postings: [...index.postings].map(([term, list]) => [
      term,
      list.map((p) => [p.chunk, p.bodyTf, p.headingTf]),
    ]),
  });
}

async function corpusIndex(): Promise<Index> {
  const docs = await loadFixtures("corpus");
  return buildIndex(docs.map((d) => parseDoc(d.raw, d.path)));
}

describe("buildIndex", () => {
  it("indexes chunks rather than whole documents", async () => {
    const index = await corpusIndex();
    // 4 chunks in transports.md, 3 in settings.md, 3 in messages.md.
    expect(index.size).toBe(10);
    expect(index.chunks).toHaveLength(10);
  });

  it("counts document frequency in chunks containing the term", () => {
    const index = buildIndex([
      parseDoc("## Alpha\n\nserver server stdio\n", "a.md"),
      parseDoc("## Beta\n\nserver transport\n", "b.md"),
    ]);
    expect(documentFrequency(index, "server")).toBe(2);
    expect(documentFrequency(index, "stdio")).toBe(1);
    expect(documentFrequency(index, "absent")).toBe(0);
  });

  it("records term frequency per chunk, in posting order", () => {
    const index = buildIndex([
      parseDoc("## Alpha\n\nserver server stdio\n", "a.md"),
      parseDoc("## Beta\n\nserver transport\n", "b.md"),
    ]);
    expect(index.postings.get("server")).toEqual([
      { chunk: 0, bodyTf: 2, headingTf: 0, ancestorTf: 0 },
      { chunk: 1, bodyTf: 1, headingTf: 0, ancestorTf: 0 },
    ]);
  });

  it("keeps heading hits separate from body hits, for the 2.4 field boost", () => {
    const index = buildIndex([
      parseDoc("## Server setup\n\nThe server starts.\n", "c.md"),
    ]);
    expect(index.postings.get("server")).toEqual([
      { chunk: 0, bodyTf: 1, headingTf: 1, ancestorTf: 0 },
    ]);
    expect(index.postings.get("setup")).toEqual([
      { chunk: 0, bodyTf: 0, headingTf: 1, ancestorTf: 0 },
    ]);
  });

  it("separates a chunk's own heading from the ones it inherits", () => {
    const index = buildIndex([
      parseDoc("## stdio\n\nbody one\n\n### Framing\n\nbody two\n", "d.md"),
    ]);
    // Chunk 0 is titled "stdio". Chunk 1 is titled "Framing" and merely sits
    // underneath it -- the word "stdio" appears nowhere in its own heading or
    // body. Counting both as heading matches would let the subsection outrank
    // the section actually about stdio, so they are tracked apart.
    expect(index.postings.get("stdio")).toEqual([
      { chunk: 0, bodyTf: 0, headingTf: 1, ancestorTf: 0 },
      { chunk: 1, bodyTf: 0, headingTf: 0, ancestorTf: 1 },
    ]);
    // Still retrievable from the child: inheritance is weakened, not dropped.
    expect(documentFrequency(index, "stdio")).toBe(2);
  });

  it("measures chunk length as body plus heading tokens", () => {
    const index = buildIndex([
      parseDoc("## Alpha\n\nserver server stdio\n", "a.md"),
      parseDoc("## Beta\n\nserver transport\n", "b.md"),
    ]);
    // ["server","server","stdio"] + ["alpha"] = 4; ["server","transport"] + ["beta"] = 3.
    expect(index.chunks.map((c) => c.length)).toEqual([4, 3]);
  });

  it("averages chunk length across the corpus", () => {
    const index = buildIndex([
      parseDoc("## Alpha\n\nserver server stdio\n", "a.md"),
      parseDoc("## Beta\n\nserver transport\n", "b.md"),
    ]);
    expect(index.avgdl).toBe(3.5);
  });

  it("carries the document title onto each chunk", async () => {
    const index = await corpusIndex();
    const fromTransports = index.chunks.filter(
      (c) => c.path === "mcp/transports.md",
    );
    expect(fromTransports).toHaveLength(4);
    for (const chunk of fromTransports) {
      expect(chunk.title).toBe("MCP Transports");
    }
  });

  it("orders the vocabulary canonically, so two builds match exactly", () => {
    const build = () =>
      buildIndex([
        parseDoc("## Zulu\n\nzebra apple\n", "z.md"),
        parseDoc("## Alpha\n\napple mango\n", "a.md"),
      ]);
    const terms = [...build().postings.keys()];
    expect(terms).toEqual([...terms].sort());
    expect(serialize(build())).toBe(serialize(build()));
  });

  it("rebuilds the real corpus deterministically", async () => {
    expect(serialize(await corpusIndex())).toBe(serialize(await corpusIndex()));
  });

  it("handles an empty corpus without throwing", () => {
    const index = buildIndex([]);
    expect(index.size).toBe(0);
    expect(index.avgdl).toBe(0);
    expect(index.chunks).toEqual([]);
    expect(index.postings.size).toBe(0);
    expect(documentFrequency(index, "server")).toBe(0);
  });

  it("contributes nothing for a document that produced no chunks", async () => {
    const docs = await loadFixtures("edge-cases");
    const empty = docs.find((d) => d.path === "empty.md");
    const index = buildIndex([parseDoc(empty!.raw, empty!.path)]);
    expect(index.size).toBe(0);
    expect(index.avgdl).toBe(0);
  });
});
