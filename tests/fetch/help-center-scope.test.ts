import { describe, expect, it } from "vitest";
import { classifyHelpCenterArticle } from "../../src/fetch/help-center-scope.js";

const url = (slug: string) => `https://support.claude.com/en/articles/12345-${slug}`;

/**
 * Encodes the Help Center scope decision from PLAN.md 2.6.5: Cowork, Claude
 * Desktop, Claude in Chrome, and Claude Mobile only -- not billing, plans,
 * SSO/enterprise admin, privacy/legal, Bedrock, or Gov. There is no
 * collections API on this Help Center (confirmed this session); classification
 * is by keyword in the article slug, built and checked against the real
 * article list pulled from the homepage, not a guessed set.
 */
describe("classifyHelpCenterArticle", () => {
  it("classifies real Cowork articles", () => {
    expect(classifyHelpCenterArticle(url("get-started-with-claude-cowork"))).toBe("cowork");
    expect(classifyHelpCenterArticle(url("schedule-recurring-tasks-in-claude-cowork"))).toBe("cowork");
    expect(classifyHelpCenterArticle(url("claude-cowork-architecture-overview"))).toBe("cowork");
  });

  it("classifies real Desktop articles", () => {
    expect(classifyHelpCenterArticle(url("install-claude-desktop"))).toBe("desktop");
    expect(classifyHelpCenterArticle(url("getting-started-with-local-mcp-servers-on-claude-desktop"))).toBe("desktop");
    expect(classifyHelpCenterArticle(url("use-quick-entry-with-claude-desktop-on-mac"))).toBe("desktop");
  });

  it("classifies real Claude in Chrome articles", () => {
    expect(classifyHelpCenterArticle(url("get-started-with-claude-in-chrome"))).toBe("chrome");
    expect(classifyHelpCenterArticle(url("use-claude-in-chrome-safely"))).toBe("chrome");
  });

  it("classifies real Mobile articles", () => {
    expect(classifyHelpCenterArticle(url("use-dictation-on-claude-mobile"))).toBe("mobile");
    expect(classifyHelpCenterArticle(url("install-claude-for-ios"))).toBe("mobile");
    expect(classifyHelpCenterArticle(url("install-claude-for-android"))).toBe("mobile");
    expect(classifyHelpCenterArticle(url("how-to-update-claude-for-ios"))).toBe("mobile");
  });

  it("excludes real enterprise/admin/deploy articles even within an included surface", () => {
    // All four are real slugs pulled from the live Help Center homepage.
    expect(classifyHelpCenterArticle(url("enterprise-configuration-for-claude-desktop"))).toBeNull();
    expect(classifyHelpCenterArticle(url("deploy-claude-desktop-for-macos"))).toBeNull();
    expect(classifyHelpCenterArticle(url("deploying-enterprise-grade-mcp-servers-with-desktop-extensions"))).toBeNull();
    expect(classifyHelpCenterArticle(url("claude-in-chrome-admin-controls"))).toBeNull();
  });

  it("excludes unrelated real articles: billing, SSO, Bedrock, general Claude", () => {
    expect(classifyHelpCenterArticle(url("add-or-update-your-team-plan-s-tax-or-vat-id"))).toBeNull();
    expect(classifyHelpCenterArticle(url("ping-identity-sso-setup"))).toBeNull();
    expect(classifyHelpCenterArticle(url("what-aws-regions-are-claude-models-available-in-amazon-bedrock"))).toBeNull();
    expect(classifyHelpCenterArticle(url("what-are-some-things-i-can-use-claude-for"))).toBeNull();
  });

  it("resolves a multi-surface article to one collection, by fixed priority", () => {
    // A real article slug mentioning cowork, desktop, and mobile all at once.
    // cowork > desktop > chrome > mobile is the tie-break, since Cowork is
    // this project's named top priority alongside Claude Code.
    expect(classifyHelpCenterArticle(url("use-claude-cowork-on-web-desktop-and-mobile"))).toBe("cowork");
  });

  it("rejects a URL from a different host", () => {
    expect(classifyHelpCenterArticle("https://code.claude.com/docs/en/overview")).toBeNull();
  });
});
