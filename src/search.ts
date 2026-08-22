/**
 * The query-facing facade: text in, a small bounded result set out.
 *
 * The character cap is the reason this server exists. A search that returns
 * whole documents is a slower way of pasting them into the context window, so
 * `maxChars` is enforced rather than aimed at. See PLAN.md step 2.5.
 */

import type { Index } from "./build-index.js";
import { rank } from "./rank.js";
import { tokenize, tokenizePositions } from "./tokenize.js";

export interface SearchOptions {
  /** Maximum hits returned. */
  limit: number;
  /** Hard ceiling on each snippet, ellipses included. */
  maxChars: number;
}

export const SEARCH_DEFAULTS: SearchOptions = {
  limit: 5,
  maxChars: 320,
};

export interface SearchHit {
  path: string;
  anchor: string | null;
  title: string;
  headingPath: string[];
  /** 1-based line in the source file, so a hit can be cited. */
  startLine: number;
  score: number;
  snippet: string;
}

const ELLIPSIS = "…";

export function search(
  index: Index,
  query: string,
  options: Partial<SearchOptions> = {},
): SearchHit[] {
  const { limit, maxChars } = { ...SEARCH_DEFAULTS, ...options };

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || limit <= 0) return [];

  return rank(index, queryTokens)
    .slice(0, limit)
    .map((result) => ({
      path: result.chunk.path,
      anchor: result.chunk.anchor,
      title: result.chunk.title,
      headingPath: result.chunk.headingPath,
      startLine: result.chunk.startLine,
      score: result.score,
      snippet: buildSnippet(result.chunk.text, new Set(result.matched), maxChars),
    }));
}

/**
 * Picks the window covering the most query terms and trims it to `maxChars`.
 *
 * A chunk can rank on its heading alone, in which case the body holds no query
 * term at all; that falls back to the opening of the body rather than returning
 * nothing.
 */
export function buildSnippet(
  text: string,
  matched: ReadonlySet<string>,
  maxChars: number,
): string {
  // Flatten first, so offsets and the character budget agree with the output.
  const flat = text.replace(/\s+/g, " ").trim();
  if (maxChars <= 0) return "";
  if (flat.length <= maxChars) return flat;

  const hits = tokenizePositions(flat).filter((position) =>
    matched.has(position.token),
  );

  const start = hits.length === 0 ? 0 : bestWindowStart(hits, flat.length, maxChars);
  return clip(flat, start, maxChars);
}

/** Anchors a window near each hit and keeps whichever covers the most. */
function bestWindowStart(
  hits: ReadonlyArray<{ start: number; end: number }>,
  textLength: number,
  maxChars: number,
): number {
  // A quarter-width lead keeps the first match off the very edge of the window.
  const lead = Math.floor(maxChars / 4);
  // A window pushed to the far end still has to pay for its leading ellipsis.
  // Clamping to `textLength - maxChars` would leave it one character short of
  // the end, and the tail snap would then drop the very word being centred on.
  const maxStart = Math.max(0, textLength - (maxChars - ELLIPSIS.length));
  let bestStart = 0;
  let bestCovered = -1;

  for (const hit of hits) {
    const start = clamp(hit.start - lead, 0, maxStart);
    const end = start + maxChars;
    const covered = hits.filter((other) => other.start >= start && other.end <= end).length;
    if (covered > bestCovered) {
      bestCovered = covered;
      bestStart = start;
    }
  }

  return bestStart;
}

/**
 * Cuts `maxChars` out of the text, snapping to word boundaries and marking
 * either end that was trimmed. The ellipses come out of the budget, so the
 * result is never longer than asked for.
 */
function clip(text: string, start: number, maxChars: number): string {
  const hasLead = start > 0;
  let budget = maxChars - (hasLead ? ELLIPSIS.length : 0);
  const hasTail = start + budget < text.length;
  if (hasTail) budget -= ELLIPSIS.length;
  if (budget <= 0) return text.slice(0, maxChars);

  let from = start;
  let to = Math.min(text.length, start + budget);

  // Snap inward to whole words. Only ever shortens, so the budget still holds.
  if (hasLead) {
    const space = text.indexOf(" ", from);
    if (space !== -1 && space < to) from = space + 1;
  }
  if (hasTail) {
    const space = text.lastIndexOf(" ", to);
    if (space > from) to = space;
  }

  const body = text.slice(from, to).trim();
  if (body === "") return text.slice(0, maxChars);

  return `${hasLead ? ELLIPSIS : ""}${body}${hasTail ? ELLIPSIS : ""}`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
