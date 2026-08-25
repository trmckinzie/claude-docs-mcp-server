import { describe, expect, it } from "vitest";
import { parseDoc } from "../src/parse-doc.js";
import type { FixtureSet } from "./fixtures/load.js";
import { loadFixtures } from "./fixtures/load.js";

async function parseFixture(set: FixtureSet, path: string) {
  const docs = await loadFixtures(set);
  const doc = docs.find((d) => d.path === path);
  if (!doc) throw new Error(`fixture not found: ${set}/${path}`);
  return parseDoc(doc.raw, doc.path);
}

describe("frontmatter", () => {
  it("reads known keys and splits tags into a list", async () => {
    const doc = await parseFixture("corpus", "mcp/transports.md");
    expect(doc.meta["title"]).toBe("MCP Transports");
    expect(doc.meta["source_url"]).toBe(
      "https://modelcontextprotocol.io/docs/concepts/transports",
    );
    expect(doc.meta["updated"]).toBe("2026-08-01");
    expect(doc.meta["tags"]).toEqual(["mcp", "transport", "stdio"]);
  });

  it("skips lines it cannot read as key and value, keeping the rest", async () => {
    const doc = await parseFixture("edge-cases", "malformed-frontmatter.md");
    expect(doc.meta["title"]).toBe("Malformed Frontmatter");
    expect(doc.meta["tags"]).toEqual(["unclosed"]);
    // The separator-less line contributes nothing rather than throwing.
    expect(Object.keys(doc.meta).sort()).toEqual(["tags", "title"]);
  });

  it("treats an unterminated block as body, not metadata", async () => {
    const doc = await parseFixture("edge-cases", "unterminated-frontmatter.md");
    expect(doc.meta).toEqual({});
    // Nothing is swallowed: the opening delimiter survives as indexable text.
    expect(doc.chunks).toHaveLength(1);
    expect(doc.chunks[0]?.text).toContain("title: Unterminated Frontmatter");
  });

  it("returns empty metadata when a file has no frontmatter", async () => {
    const doc = await parseFixture("edge-cases", "no-frontmatter.md");
    expect(doc.meta).toEqual({});
  });

  it("parses an empty file into nothing indexable", async () => {
    const doc = await parseFixture("edge-cases", "empty.md");
    expect(doc.meta).toEqual({});
    expect(doc.chunks).toEqual([]);
  });
});

describe("chunking", () => {
  it("splits a document at its headings, keeping a lead chunk", async () => {
    const doc = await parseFixture("corpus", "mcp/transports.md");
    expect(doc.chunks.map((c) => c.heading)).toEqual([
      null,
      "stdio",
      "Framing",
      "HTTP",
    ]);
    expect(doc.chunks[0]?.text).toBe(
      "Transports carry JSON-RPC messages between an MCP client and an MCP server.",
    );
  });

  it("nests heading paths so a subsection carries its parent", async () => {
    const doc = await parseFixture("corpus", "mcp/transports.md");
    const byHeading = new Map(doc.chunks.map((c) => [c.heading, c]));
    expect(byHeading.get("stdio")?.headingPath).toEqual(["stdio"]);
    expect(byHeading.get("Framing")?.headingPath).toEqual(["stdio", "Framing"]);
    // HTTP is a sibling of stdio, so the stack pops back to one level.
    expect(byHeading.get("HTTP")?.headingPath).toEqual(["HTTP"]);
  });

  it("ignores a heading-shaped line inside a fenced code block", async () => {
    const doc = await parseFixture("corpus", "mcp/transports.md");
    const stdio = doc.chunks.find((c) => c.heading === "stdio");
    expect(stdio?.text).toContain("## this line is inside a fence");
    // Four chunks, not five: the fenced line did not open one.
    expect(doc.chunks).toHaveLength(4);
  });

  it("does not close a fence early on a line that has fence characters plus trailing content", () => {
    // Per CommonMark, only an opening fence may carry trailing info-string
    // text (` ```bash `). A closing fence must contain nothing else -- a doc
    // that shows fence syntax as an example inside its own fenced block must
    // not have that example line treated as the real close.
    const doc = parseDoc(
      [
        "## Real section",
        "",
        "```bash",
        "echo hi",
        "``` this looks like a close but has trailing text",
        "## still inside the fence",
        "genuinely fenced content",
        "```",
        "",
        "After the real close.",
      ].join("\n"),
      "fence-trailing.md",
    );
    expect(doc.chunks.map((c) => c.heading)).toEqual(["Real section"]);
    expect(doc.chunks[0]?.text).toContain("## still inside the fence");
    expect(doc.chunks[0]?.text).toContain("After the real close.");
  });

  it("ignores a heading inside a tilde fence too", () => {
    const doc = parseDoc(
      ["## Real", "", "~~~", "## Fenced", "~~~", "", "## Also real", ""].join(
        "\n",
      ),
      "synthetic.md",
    );
    expect(doc.chunks.map((c) => c.heading)).toEqual(["Real", "Also real"]);
  });

  it("keeps headings deeper than the split level as ordinary content", () => {
    const doc = parseDoc(
      ["## Section", "", "#### Deep", "", "Body text.", ""].join("\n"),
      "synthetic.md",
    );
    expect(doc.chunks).toHaveLength(1);
    expect(doc.chunks[0]?.text).toContain("#### Deep");
  });

  it("drops the lead chunk when a document opens on a heading", async () => {
    const doc = await parseFixture("edge-cases", "no-frontmatter.md");
    expect(doc.chunks.map((c) => c.heading)).toEqual(["Orphan Document", "Body"]);
    expect(doc.chunks.map((c) => c.headingPath)).toEqual([
      ["Orphan Document"],
      ["Orphan Document", "Body"],
    ]);
  });

  it("collapses a document with no headings into a single lead chunk", async () => {
    const doc = await parseFixture("edge-cases", "no-headings.md");
    expect(doc.chunks).toHaveLength(1);
    expect(doc.chunks[0]?.heading).toBeNull();
    expect(doc.chunks[0]?.level).toBe(0);
    expect(doc.chunks[0]?.text).toContain("A second paragraph");
  });

  it("records the source line each chunk starts on", async () => {
    const doc = await parseFixture("corpus", "mcp/transports.md");
    // Line 8 is the lead paragraph; line 10 is the "## stdio" heading itself.
    expect(doc.chunks[0]?.startLine).toBe(8);
    expect(doc.chunks[1]?.startLine).toBe(10);
  });
});

describe("anchors", () => {
  it("slugifies heading text", async () => {
    const doc = await parseFixture("corpus", "claude-code/settings.md");
    expect(doc.chunks.map((c) => c.anchor)).toEqual([
      null,
      "permissions",
      "declaring-servers",
    ]);
  });

  it("disambiguates repeated headings so anchors stay unique", () => {
    const doc = parseDoc(
      ["## Setup", "a", "## Setup", "b", "## Setup", "c"].join("\n"),
      "synthetic.md",
    );
    expect(doc.chunks.map((c) => c.anchor)).toEqual([
      "setup",
      "setup-2",
      "setup-3",
    ]);
  });
});

describe("title", () => {
  it("prefers the frontmatter title", async () => {
    const doc = await parseFixture("corpus", "api/messages.md");
    expect(doc.title).toBe("Messages API");
  });

  it("falls back to the first level-one heading", async () => {
    const doc = await parseFixture("edge-cases", "no-frontmatter.md");
    expect(doc.title).toBe("Orphan Document");
  });

  it("falls back to the file stem when nothing else is available", async () => {
    const doc = await parseFixture("edge-cases", "unterminated-frontmatter.md");
    expect(doc.title).toBe("unterminated-frontmatter");
  });
});
