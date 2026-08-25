import { describe, expect, it } from "vitest";
import { assertSafeFetchUrl, isPathInsideDocs } from "../../src/fetch/url-safety.js";

/**
 * Concrete security rules from PLAN.md 2.6.5: fetch only from an explicit
 * host allowlist, HTTPS-only, and never write outside `docs/` regardless of
 * what a URL or title claims. Defense in depth -- today's three sources are
 * trusted, but nothing here should rely on that trust implicitly.
 */
describe("assertSafeFetchUrl", () => {
  it("accepts an https URL on an allowed host", () => {
    expect(() =>
      assertSafeFetchUrl("https://code.claude.com/docs/en/overview"),
    ).not.toThrow();
    expect(() =>
      assertSafeFetchUrl("https://platform.claude.com/docs/en/get-started"),
    ).not.toThrow();
    expect(() =>
      assertSafeFetchUrl("https://support.claude.com/en/articles/123-x"),
    ).not.toThrow();
  });

  it("rejects a host that isn't on the allowlist", () => {
    expect(() => assertSafeFetchUrl("https://evil.example.com/x")).toThrow();
    // A convincing lookalike must not pass a naive substring check.
    expect(() => assertSafeFetchUrl("https://code.claude.com.evil.com/x")).toThrow();
    expect(() => assertSafeFetchUrl("https://not-code.claude.com/x")).toThrow();
  });

  it("rejects plain http, even on an allowed host", () => {
    expect(() => assertSafeFetchUrl("http://code.claude.com/docs/en/overview")).toThrow();
  });

  it("rejects a URL that fails to parse", () => {
    expect(() => assertSafeFetchUrl("not a url")).toThrow();
    expect(() => assertSafeFetchUrl("")).toThrow();
  });

  it("rejects a non-http(s) scheme on an otherwise-allowed host string", () => {
    expect(() => assertSafeFetchUrl("file:///etc/passwd")).toThrow();
    expect(() => assertSafeFetchUrl("javascript:alert(1)")).toThrow();
  });
});

describe("isPathInsideDocs", () => {
  it("accepts an ordinary nested path", () => {
    expect(isPathInsideDocs("docs", "claude-code/overview.md")).toBe(true);
    expect(isPathInsideDocs("docs", "cowork/getting-started.md")).toBe(true);
  });

  it("rejects a path that escapes the docs root via ..", () => {
    expect(isPathInsideDocs("docs", "../outside.md")).toBe(false);
    expect(isPathInsideDocs("docs", "claude-code/../../outside.md")).toBe(false);
  });

  it("rejects an absolute path", () => {
    expect(isPathInsideDocs("docs", "/etc/passwd")).toBe(false);
  });

  it("rejects a path that is the docs root itself with nothing after it", () => {
    // A manifest entry always names a file; the bare root is not a valid target.
    expect(isPathInsideDocs("docs", "")).toBe(false);
    expect(isPathInsideDocs("docs", ".")).toBe(false);
  });
});
