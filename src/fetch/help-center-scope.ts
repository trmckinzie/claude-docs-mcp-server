/**
 * Classifies a Help Center article URL into one of the four target
 * collections, or out of scope entirely. See PLAN.md 2.6.5.
 *
 * support.claude.com exposes no collections API (confirmed this session --
 * the standard Zendesk endpoint 404s and the homepage is Next.js-rendered,
 * not a classic Zendesk theme). Classification is by keyword in the article
 * slug instead, built and checked against the real article list pulled from
 * the live homepage, not a guessed set. Approximate by design: a keyword
 * filter over free-text slugs will misclassify the odd borderline article
 * (e.g. a plan-comparison page that happens to mention "enterprise" only in
 * passing) -- accepted, since the alternative is hand-curating ~350 articles.
 */

export type HelpCenterCollection = "cowork" | "desktop" | "chrome" | "mobile";

/** Checked in this order, so an article naming several surfaces at once
 * resolves to exactly one. Cowork first: it's this project's named top
 * priority alongside Claude Code. */
const INCLUDE_RULES: ReadonlyArray<{ collection: HelpCenterCollection; keywords: RegExp }> = [
  { collection: "cowork", keywords: /cowork/ },
  { collection: "desktop", keywords: /desktop/ },
  { collection: "chrome", keywords: /chrome/ },
  { collection: "mobile", keywords: /mobile|-ios(-|$)|for-ios|-android(-|$)|for-android/ },
];

/** Real slugs confirmed to need this: enterprise/admin/deploy content sits
 * inside otherwise-included collections (e.g. "deploy-claude-desktop-for-macos"). */
const EXCLUDE_KEYWORDS = /enterprise|admin|deploy|\bsso\b|bedrock|government/;

export function classifyHelpCenterArticle(url: string): HelpCenterCollection | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "support.claude.com") return null;

  const slug = parsed.pathname.toLowerCase();
  if (EXCLUDE_KEYWORDS.test(slug)) return null;

  const match = INCLUDE_RULES.find((rule) => rule.keywords.test(slug));
  return match?.collection ?? null;
}
