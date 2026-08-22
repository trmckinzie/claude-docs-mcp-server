import { describe, expect, it } from "vitest";
import { buildIndex } from "../src/build-index.js";
import type { Index } from "../src/build-index.js";
import { parseDoc } from "../src/parse-doc.js";
import { BM25_DEFAULTS, inverseDocumentFrequency, rank } from "../src/rank.js";
import { tokenize } from "../src/tokenize.js";
import { loadFixtures } from "./fixtures/load.js";

/** Two chunks with hand-computable lengths: 4 tokens and 3, so avgdl is 3.5. */
function tinyIndex(): Index {
  return buildIndex([
    parseDoc("## Alpha\n\nserver server stdio\n", "a.md"),
    parseDoc("## Beta\n\nserver transport\n", "b.md"),
  ]);
}

async function corpusIndex(): Promise<Index> {
  const docs = await loadFixtures("corpus");
  return buildIndex(docs.map((d) => parseDoc(d.raw, d.path)));
}

/** "path#anchor" labels, so an ordering assertion reads like the result list. */
function labels(index: Index, query: string): string[] {
  return rank(index, tokenize(query)).map(
    (r) => `${r.chunk.path}#${r.chunk.anchor ?? "(lead)"}`,
  );
}

describe("inverseDocumentFrequency", () => {
  it("scores a rare term far above a ubiquitous one", () => {
    const index = tinyIndex();
    // stdio is in 1 of 2 chunks; server is in both.
    expect(inverseDocumentFrequency(index, "stdio")).toBeCloseTo(0.6931, 4);
    expect(inverseDocumentFrequency(index, "server")).toBeCloseTo(0.1823, 4);
  });

  it("floors at zero rather than going negative for a term in every chunk", () => {
    const index = tinyIndex();
    // The textbook idf is negative once df exceeds half the corpus, which would
    // let a common term subtract from a score. This variant cannot.
    expect(inverseDocumentFrequency(index, "server")).toBeGreaterThan(0);
    expect(inverseDocumentFrequency(index, "absent")).toBe(0);
  });
});

describe("rank", () => {
  it("computes the textbook BM25 score", () => {
    const index = tinyIndex();
    const [top] = rank(index, ["stdio"]);
    // idf 0.6931 * (1 * 2.2) / (1 + 1.2 * (0.25 + 0.75 * 4/3.5)) = 0.6549
    expect(top?.score).toBeCloseTo(0.65, 2);
    expect(top?.chunk.path).toBe("a.md");
    expect(top?.matched).toEqual(["stdio"]);
  });

  it("weights a heading match above a body match", () => {
    const index = buildIndex([
      parseDoc("## stdio transport\n\nnothing relevant here\n", "heading.md"),
      parseDoc("## Other\n\nstdio appears in body\n", "body.md"),
    ]);
    expect(rank(index, ["stdio"]).map((r) => r.chunk.path)).toEqual([
      "heading.md",
      "body.md",
    ]);
  });

  it("does not let a long chunk beat a short focused one at equal term count", () => {
    const index = buildIndex([
      parseDoc(`## Long page\n\nstdio ${"filler ".repeat(40)}\n`, "long.md"),
      parseDoc("## Short page\n\nstdio\n", "short.md"),
    ]);
    expect(rank(index, ["stdio"]).map((r) => r.chunk.path)).toEqual([
      "short.md",
      "long.md",
    ]);
  });

  it("returns only chunks that actually matched", () => {
    const index = tinyIndex();
    expect(rank(index, ["stdio"])).toHaveLength(1);
    expect(rank(index, ["server"])).toHaveLength(2);
  });

  it("reports which query terms contributed to each hit", () => {
    const index = tinyIndex();
    const [top] = rank(index, ["server", "stdio"]);
    expect(top?.chunk.path).toBe("a.md");
    expect(top?.matched).toEqual(["server", "stdio"]);
  });

  it("returns nothing for an unknown term, an empty query, or an empty index", () => {
    const index = tinyIndex();
    expect(rank(index, ["notacorpusword"])).toEqual([]);
    expect(rank(index, [])).toEqual([]);
    expect(rank(buildIndex([]), ["server"])).toEqual([]);
  });

  it("counts a repeated query term once", () => {
    const index = tinyIndex();
    expect(rank(index, ["stdio", "stdio"])[0]?.score).toBeCloseTo(
      rank(index, ["stdio"])[0]?.score ?? 0,
      10,
    );
  });

  it("breaks ties by path, then by position in the file", () => {
    const index = buildIndex([
      parseDoc("## Same\n\nstdio here\n", "b.md"),
      parseDoc("## Same\n\nstdio here\n", "a.md"),
    ]);
    const results = rank(index, ["stdio"]);
    expect(results[0]?.score).toBeCloseTo(results[1]?.score ?? 0, 10);
    expect(results.map((r) => r.chunk.path)).toEqual(["a.md", "b.md"]);
  });

  it("is deterministic", async () => {
    const index = await corpusIndex();
    expect(labels(index, "mcp stdio transport")).toEqual(
      labels(index, "mcp stdio transport"),
    );
  });

  it("honours tuning options", () => {
    const index = tinyIndex();
    const standard = rank(index, ["stdio"])[0]?.score ?? 0;
    // b = 0 removes length normalisation entirely, so the score must move.
    const unnormalised = rank(index, ["stdio"], { b: 0 })[0]?.score ?? 0;
    expect(unnormalised).not.toBeCloseTo(standard, 4);
    expect(BM25_DEFAULTS).toEqual({
      k1: 1.2,
      b: 0.75,
      headingBoost: 2,
      ancestorBoost: 1,
    });
  });
});

describe("ranking the real corpus", () => {
  it("puts the stdio section first for a stdio query", async () => {
    const index = await corpusIndex();
    // The section headed "stdio" must beat its own subsection, which only
    // inherits the word from its parent heading.
    expect(labels(index, "stdio").slice(0, 2)).toEqual([
      "mcp/transports.md#stdio",
      "mcp/transports.md#framing",
    ]);
  });

  it("finds the permissions section for a permissions question", async () => {
    const index = await corpusIndex();
    expect(labels(index, "how do permissions allow and deny rules work")[0]).toBe(
      "claude-code/settings.md#permissions",
    );
  });

  it("finds the streaming section for a streaming question", async () => {
    const index = await corpusIndex();
    expect(labels(index, "streaming events")[0]).toBe("api/messages.md#streaming");
  });
});
