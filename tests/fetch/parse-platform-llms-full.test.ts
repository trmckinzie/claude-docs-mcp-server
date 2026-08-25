import { describe, expect, it } from "vitest";
import { parsePlatformLlmsFull } from "../../src/fetch/parse-platform-llms-full.js";

/**
 * Confirmed against the real 40MB file: platform.claude.com's llms-full.txt
 * uses a DIFFERENT grammar from code.claude.com's -- a fenced
 * `---\ntitle:...\nurl:...\n---` block, not a `# Title`/`Source:` pair. The
 * preceding `## heading` is not reliable as a title source: it's frequently
 * an unrelated in-body subheading like "## Next steps" left over from the
 * previous record, at a variable distance from the block. The block's own
 * `title:` key is the only trustworthy title source. 1234 bare `---` lines
 * were found for 612 records in the real file -- exactly 2x, zero stray ones
 * -- so the grammar is internally consistent, but the parser still guards
 * against a body coincidentally containing an illustrative `---` example.
 */
describe("parsePlatformLlmsFull", () => {
  it("splits a single record", () => {
    const text = [
      "## Docs home",
      "",
      "---",
      "title: Documentation",
      "url: https://platform.claude.com/docs/en/home",
      "description: Claude API Documentation",
      "---",
      "",
      "Body content here.",
    ].join("\n");

    expect(parsePlatformLlmsFull(text)).toEqual([
      {
        title: "Documentation",
        sourceUrl: "https://platform.claude.com/docs/en/home",
        body: "Body content here.",
      },
    ]);
  });

  it("ignores the preceding ## heading entirely, taking title only from the block", () => {
    // Reproduces the real file's "## Messages" / "### First steps" case: two
    // headings sit between records, neither of which names the real page.
    const text = [
      "## Messages",
      "",
      "### First steps",
      "",
      "---",
      "title: Get started with Claude",
      "url: https://platform.claude.com/docs/en/get-started",
      "description: Make your first API call.",
      "---",
      "",
      "## Prerequisites",
      "",
      "Body.",
    ].join("\n");

    const records = parsePlatformLlmsFull(text);
    expect(records).toHaveLength(1);
    expect(records[0]?.title).toBe("Get started with Claude");
    expect(records[0]?.body).toContain("## Prerequisites");
  });

  it("splits multiple records, each ending where the next block opens", () => {
    const text = [
      "---",
      "title: First",
      "url: https://platform.claude.com/docs/en/first",
      "---",
      "",
      "First body.",
      "",
      "## Next steps",
      "",
      "---",
      "title: Second",
      "url: https://platform.claude.com/docs/en/second",
      "---",
      "",
      "Second body.",
    ].join("\n");

    const records = parsePlatformLlmsFull(text);
    expect(records).toEqual([
      {
        title: "First",
        sourceUrl: "https://platform.claude.com/docs/en/first",
        body: "First body.\n\n## Next steps",
      },
      {
        title: "Second",
        sourceUrl: "https://platform.claude.com/docs/en/second",
        body: "Second body.",
      },
    ]);
  });

  it("handles a block with no description line", () => {
    const text = [
      "---",
      "title: No Description",
      "url: https://platform.claude.com/docs/en/no-desc",
      "---",
      "",
      "Body.",
    ].join("\n");
    expect(parsePlatformLlmsFull(text)[0]?.title).toBe("No Description");
  });

  it("does not treat a body's own illustrative --- block as a record boundary", () => {
    // A page documenting frontmatter syntax could show one as an example.
    // Real records always have a platform.claude.com url on the second line;
    // this guard is what the parser checks for.
    const text = [
      "---",
      "title: Real Page",
      "url: https://platform.claude.com/docs/en/real",
      "---",
      "",
      "Example frontmatter you might write:",
      "",
      "```",
      "---",
      "title: your title here",
      "not_a_url_line: whatever",
      "---",
      "```",
      "",
      "More real body.",
    ].join("\n");

    const records = parsePlatformLlmsFull(text);
    expect(records).toHaveLength(1);
    expect(records[0]?.body).toContain("your title here");
    expect(records[0]?.body).toContain("More real body.");
  });

  it("returns an empty list for empty input or input with no valid record", () => {
    expect(parsePlatformLlmsFull("")).toEqual([]);
    expect(parsePlatformLlmsFull("# Just a banner\n\nNo records here.\n")).toEqual([]);
  });

  it("discards a preamble banner with no record markers before the first real record", () => {
    const text = [
      "# Anthropic Developer Documentation - Full Content",
      "",
      "This file provides comprehensive documentation.",
      "",
      "---",
      "title: Real Start",
      "url: https://platform.claude.com/docs/en/real-start",
      "---",
      "",
      "Body.",
    ].join("\n");
    const records = parsePlatformLlmsFull(text);
    expect(records).toHaveLength(1);
    expect(records[0]?.title).toBe("Real Start");
  });
});
