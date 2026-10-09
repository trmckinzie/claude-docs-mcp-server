import { describe, expect, it } from "vitest";
import { extractArticleUrls, findVanishedSites } from "../../src/fetch/help-center-discovery.js";

describe("extractArticleUrls", () => {
  // 2026-10-09: support.claude.com's homepage started rendering only a few
  // links as href attributes; the rest sit in embedded JSON. Matching only
  // href="..." found 7 of ~360 articles and none in scope.
  it("finds article URLs in href attributes and in embedded JSON alike", () => {
    const html =
      '<a href="https://support.claude.com/en/articles/1-get-started">x</a>' +
      '<script>{"url":"https://support.claude.com/en/articles/2-use-claude-cowork-safely"}</script>';
    expect(extractArticleUrls(html)).toEqual([
      "https://support.claude.com/en/articles/1-get-started",
      "https://support.claude.com/en/articles/2-use-claude-cowork-safely",
    ]);
  });

  it("returns each article once, and ignores other hosts and non-article paths", () => {
    const html =
      "https://support.claude.com/en/articles/2-a https://support.claude.com/en/articles/2-a " +
      "https://evil.example/en/articles/3-b https://support.claude.com/en/collections/4-c";
    expect(extractArticleUrls(html)).toEqual(["https://support.claude.com/en/articles/2-a"]);
  });
});

describe("findVanishedSites", () => {
  const entry = (sourceSite: "code" | "platform" | "support") => ({ sourceSite });

  // The same day, that empty discovery read as "every Help Center article was
  // removed upstream" and deleted all 41 from disk. A source that had pages
  // and now returns none is a broken fetch, not a deletion.
  it("names a site that had entries last run and has none now", () => {
    expect(findVanishedSites([entry("code"), entry("support")], [entry("code")])).toEqual(["support"]);
  });

  it("is empty when every previously present site still returns something", () => {
    expect(findVanishedSites([entry("code"), entry("support")], [entry("support"), entry("code")])).toEqual([]);
  });

  it("does not complain about a site that never had entries", () => {
    expect(findVanishedSites([entry("code")], [entry("code")])).toEqual([]);
  });
});
