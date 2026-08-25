import { describe, expect, it } from "vitest";
import { buildIndex } from "../src/build-index.js";
import type { Index } from "../src/build-index.js";
import { parseDoc } from "../src/parse-doc.js";
import { SEARCH_DEFAULTS, search } from "../src/search.js";
import { loadFixtures } from "./fixtures/load.js";

async function corpusIndex(): Promise<Index> {
  const docs = await loadFixtures("corpus");
  return buildIndex(docs.map((d) => parseDoc(d.raw, d.path)));
}

/** One long chunk with the query term buried near the end. */
function buriedTermIndex(): Index {
  const filler = "some ordinary prose that carries no signal at all. ".repeat(12);
  return buildIndex([
    parseDoc(`## Logging\n\n${filler}Diagnostics belong on stderr.\n`, "long.md"),
  ]);
}

describe("search", () => {
  it("returns hits with everything needed to render them", async () => {
    const index = await corpusIndex();
    const [top] = search(index, "streaming events");
    expect(top).toMatchObject({
      path: "api/messages.md",
      anchor: "streaming",
      title: "Messages API",
      headingPath: ["Streaming"],
    });
    expect(top?.score).toBeGreaterThan(0);
    expect(top?.startLine).toBeGreaterThan(0);
    expect(typeof top?.snippet).toBe("string");
  });

  it("does not leak a mutable reference into the shared index", async () => {
    // The index is a long-lived singleton for the life of the server
    // (src/index.ts builds one and reuses it for every search_docs call).
    // If a hit's headingPath were the same array object as the chunk's own,
    // a caller mutating one returned hit would corrupt that chunk's heading
    // trail for every subsequent search in the same running process.
    const index = await corpusIndex();
    const [top] = search(index, "streaming events");
    top?.headingPath.push("mutated");

    const [again] = search(index, "streaming events");
    expect(again?.headingPath).toEqual(["Streaming"]);
  });

  it("caps the number of hits", async () => {
    const index = await corpusIndex();
    expect(search(index, "server").length).toBeLessThanOrEqual(
      SEARCH_DEFAULTS.limit,
    );
    expect(search(index, "server", { limit: 2 })).toHaveLength(2);
    expect(search(index, "server", { limit: 0 })).toHaveLength(0);
  });

  it("never exceeds maxChars, whatever the limit is set to", async () => {
    const index = await corpusIndex();
    for (const maxChars of [400, 200, 80, 40, 12, 3]) {
      for (const hit of search(index, "server transport stdio", { maxChars })) {
        expect(hit.snippet.length, `maxChars=${String(maxChars)}`).toBeLessThanOrEqual(
          maxChars,
        );
      }
    }
  });

  it("centres the snippet on the match instead of always taking the opening", () => {
    const index = buriedTermIndex();
    const [hit] = search(index, "stderr", { maxChars: 90 });
    expect(hit?.snippet.toLowerCase()).toContain("stderr");
    // The match is at the very end, so the opening must have been dropped.
    expect(hit?.snippet.startsWith("…")).toBe(true);
  });

  it("marks a snippet that was cut at either end", () => {
    const index = buriedTermIndex();
    const [hit] = search(index, "ordinary", { maxChars: 90 });
    expect(hit?.snippet.startsWith("…") || hit?.snippet.endsWith("…")).toBe(true);
  });

  it("returns the whole body when it already fits, with no ellipsis", async () => {
    const index = await corpusIndex();
    const [hit] = search(index, "mcp transport", { maxChars: 400 });
    expect(hit?.snippet).toBe(
      "Transports carry JSON-RPC messages between an MCP client and an MCP server.",
    );
  });

  it("includes a query term in the snippet when the body contains one", async () => {
    const index = await corpusIndex();
    for (const hit of search(index, "permissions deny rules")) {
      const body = hit.snippet.toLowerCase();
      if (/permission|deny|rule/.test(hit.snippet)) {
        expect(body).toMatch(/permission|deny|rule/);
      }
    }
    const [top] = search(index, "permissions deny rules");
    expect(top?.snippet.toLowerCase()).toMatch(/permission|deny|rule/);
  });

  it("still returns a snippet for a chunk matched only through its heading", () => {
    const index = buildIndex([
      parseDoc("## stdio\n\nNothing here repeats the title.\n", "h.md"),
    ]);
    const [hit] = search(index, "stdio");
    // Matched via the heading, so the body holds no query term -- fall back to
    // the opening of the body rather than returning nothing.
    expect(hit?.snippet).toBe("Nothing here repeats the title.");
  });

  it("flattens whitespace so a snippet is one readable line", async () => {
    const index = await corpusIndex();
    for (const hit of search(index, "stdio standard output")) {
      expect(hit.snippet).not.toMatch(/\n/);
      expect(hit.snippet).not.toMatch(/ {2}/);
    }
  });

  it("returns nothing for a query with no usable terms", async () => {
    const index = await corpusIndex();
    expect(search(index, "")).toEqual([]);
    expect(search(index, "   ")).toEqual([]);
    expect(search(index, "the and of to")).toEqual([]);
    expect(search(index, "notacorpusword")).toEqual([]);
  });

  it("orders hits the same way on every call", async () => {
    const index = await corpusIndex();
    const once = search(index, "mcp server transport").map((h) => h.anchor);
    const twice = search(index, "mcp server transport").map((h) => h.anchor);
    expect(once).toEqual(twice);
  });

  it("keeps a whole result set small enough to be worth returning", async () => {
    const index = await corpusIndex();
    const total = search(index, "mcp server transport stdio streaming")
      .map((h) => h.snippet.length)
      .reduce((a, b) => a + b, 0);
    // The entire point of the server: a response bounded by limit * maxChars.
    expect(total).toBeLessThanOrEqual(
      SEARCH_DEFAULTS.limit * SEARCH_DEFAULTS.maxChars,
    );
  });
});
