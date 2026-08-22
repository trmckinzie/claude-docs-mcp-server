import { describe, expect, it } from "vitest";
import { loadFixtures } from "./fixtures/load.js";

/**
 * These tests guard the fixtures themselves. The corpus is hand-tuned ground
 * truth for the BM25 assertions in PLAN.md 2.3-2.4 -- if someone edits a
 * fixture and shifts a document frequency, those score tests would start
 * failing for a reason that has nothing to do with the ranker.
 */
describe("corpus fixtures", () => {
  it("loads exactly the three ranking documents, in a stable order", async () => {
    const docs = await loadFixtures("corpus");
    expect(docs.map((d) => d.path)).toEqual([
      "api/messages.md",
      "claude-code/settings.md",
      "mcp/transports.md",
    ]);
  });

  it("gives every corpus document closed frontmatter with title and source_url", async () => {
    const docs = await loadFixtures("corpus");
    for (const doc of docs) {
      expect(doc.raw.startsWith("---\n"), doc.path).toBe(true);
      expect(doc.raw, doc.path).toMatch(/^title: \S.*$/m);
      expect(doc.raw, doc.path).toMatch(/^source_url: https:\/\/\S+$/m);
    }
  });

  it("pins the document frequencies the ranker tests depend on", async () => {
    const docs = await loadFixtures("corpus");
    // Deliberately naive splitting, close to what tokenize() will do in 2.2.
    const wordsOf = (raw: string) =>
      new Set(raw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    const corpus = docs.map((d) => wordsOf(d.raw));
    const df = (term: string) => corpus.filter((words) => words.has(term)).length;

    // df=1: the discriminating term. "mcp stdio transport" must rank transports.md first.
    expect(df("stdio")).toBe(1);
    // df=2: present in the MCP and Claude Code docs, absent from the API doc.
    expect(df("mcp")).toBe(2);
    // df=3: everywhere, so idf floors to ~0 and it should contribute nothing.
    expect(df("server")).toBe(3);
  });

  it("hides a ## line inside a fenced code block, to pin the chunker", async () => {
    const docs = await loadFixtures("corpus");
    const transports = docs.find((d) => d.path === "mcp/transports.md");
    expect(transports).toBeDefined();
    expect(transports!.raw).toMatch(/```bash\n(?:.*\n)*?## .*\n(?:.*\n)*?```/);
  });
});

describe("edge-case fixtures", () => {
  it("covers every parser failure mode listed in PLAN.md 2.1", async () => {
    const docs = await loadFixtures("edge-cases");
    expect(docs.map((d) => d.path)).toEqual([
      "empty.md",
      "malformed-frontmatter.md",
      "no-frontmatter.md",
      "no-headings.md",
      "unterminated-frontmatter.md",
    ]);
  });

  it("keeps empty.md genuinely empty", async () => {
    const docs = await loadFixtures("edge-cases");
    expect(docs.find((d) => d.path === "empty.md")?.raw).toBe("");
  });
});
