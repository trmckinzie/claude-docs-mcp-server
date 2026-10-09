/**
 * Help Center discovery and the guard that keeps a broken fetch from reading
 * as a mass deletion. Pure: no fs, no network.
 */

import type { SourceSite } from "./manifest.js";

const ARTICLE_URL_RE = /https:\/\/support\.claude\.com\/en\/articles\/[0-9]+-[a-z0-9-]*/g;

/**
 * Every Help Center article URL in the homepage, in first-seen order, once
 * each. Matches the URL anywhere in the page rather than only inside
 * `href="..."`: since 2026-10-09 the homepage renders most of its links from
 * embedded JSON, and the href-only match found 7 of ~360 articles.
 */
export function extractArticleUrls(html: string): string[] {
  return [...new Set(html.match(ARTICLE_URL_RE) ?? [])];
}

/**
 * Sites that had manifest entries last run and contribute none this run. A
 * source going from some pages to zero is a broken fetch (a changed page
 * layout, a block), never a real upstream deletion of everything -- and the
 * reconciliation that follows would delete them all from disk.
 */
export function findVanishedSites(
  previous: ReadonlyArray<{ sourceSite: SourceSite }>,
  fresh: ReadonlyArray<{ sourceSite: SourceSite }>,
): SourceSite[] {
  const before = new Set(previous.map((e) => e.sourceSite));
  const now = new Set(fresh.map((e) => e.sourceSite));
  return [...before].filter((site) => !now.has(site)).sort();
}
