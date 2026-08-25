import { describe, expect, it } from "vitest";
import { parseLlmsFull } from "../../src/fetch/parse-llms-full.js";

/**
 * Record grammar confirmed against the real files, not assumed:
 * `# Title` immediately followed by `Source: <url>`, a blank line, then body,
 * repeating. A page's own `##` subheadings must not be mistaken for a record
 * boundary -- only a bare `# ` line directly followed by `Source:` counts.
 */
describe("parseLlmsFull", () => {
  it("splits a single record", () => {
    const text = "# Overview\nSource: https://code.claude.com/docs/en/overview\n\nBody text here.\n";
    expect(parseLlmsFull(text)).toEqual([
      {
        title: "Overview",
        sourceUrl: "https://code.claude.com/docs/en/overview",
        body: "Body text here.",
      },
    ]);
  });

  it("splits multiple records separated by a blank line", () => {
    const text = [
      "# First page",
      "Source: https://code.claude.com/docs/en/first",
      "",
      "First body.",
      "",
      "# Second page",
      "Source: https://code.claude.com/docs/en/second",
      "",
      "Second body.",
      "spanning two lines.",
      "",
    ].join("\n");

    expect(parseLlmsFull(text)).toEqual([
      {
        title: "First page",
        sourceUrl: "https://code.claude.com/docs/en/first",
        body: "First body.",
      },
      {
        title: "Second page",
        sourceUrl: "https://code.claude.com/docs/en/second",
        body: "Second body.\nspanning two lines.",
      },
    ]);
  });

  it("does not mistake a page's own subheading for a record boundary", () => {
    // A "## " heading, or a "# " line NOT immediately followed by "Source:",
    // must stay inside the current record's body.
    const text = [
      "# Admin setup",
      "Source: https://code.claude.com/docs/en/admin-setup",
      "",
      "Intro.",
      "",
      "## Set up usage visibility",
      "",
      "More body, including a line that starts with a hash but isn't a title:",
      "# just some emphasized text, not a heading",
      "",
      "# Next real page",
      "Source: https://code.claude.com/docs/en/next-real-page",
      "",
      "Next body.",
    ].join("\n");

    const records = parseLlmsFull(text);
    expect(records).toHaveLength(2);
    expect(records[0]?.title).toBe("Admin setup");
    expect(records[0]?.body).toContain("## Set up usage visibility");
    expect(records[0]?.body).toContain("# just some emphasized text, not a heading");
    expect(records[1]?.title).toBe("Next real page");
  });

  it("does not split on a body line that merely resembles a Source: marker", () => {
    // A body paragraph could plausibly mention "Source: " as prose. Only a
    // line matching the marker immediately after a "# " line is a boundary.
    const text = [
      "# Real page",
      "Source: https://code.claude.com/docs/en/real",
      "",
      "This section explains config precedence.",
      "Source: this is prose, not a new record, because no # line precedes it",
      "",
      "# Another page",
      "Source: https://code.claude.com/docs/en/another",
      "",
      "Body.",
    ].join("\n");

    const records = parseLlmsFull(text);
    expect(records).toHaveLength(2);
    expect(records[0]?.body).toContain("Source: this is prose");
  });

  it("trims trailing and leading whitespace from each body", () => {
    const text = "# Page\nSource: https://code.claude.com/docs/en/page\n\n\n  Body with padding.  \n\n\n";
    expect(parseLlmsFull(text)[0]?.body).toBe("Body with padding.");
  });

  it("returns an empty list for empty input", () => {
    expect(parseLlmsFull("")).toEqual([]);
    expect(parseLlmsFull("   \n\n  ")).toEqual([]);
  });

  it("ignores leading content before the first valid record marker", () => {
    // Defensive: if the file ever opens with a banner or comment before the
    // first real record, that preamble is discarded rather than crashing.
    const text = [
      "This is a preamble with no title/Source pair.",
      "",
      "# Real page",
      "Source: https://code.claude.com/docs/en/real",
      "",
      "Body.",
    ].join("\n");
    const records = parseLlmsFull(text);
    expect(records).toHaveLength(1);
    expect(records[0]?.title).toBe("Real page");
  });
});
