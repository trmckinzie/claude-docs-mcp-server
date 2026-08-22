/**
 * BM25 ranking over the chunk index. Pure, and deterministic down to the tie
 * break, so its scores can be asserted exactly. See PLAN.md step 2.4.
 */

import { documentFrequency } from "./build-index.js";
import type { Index, IndexedChunk } from "./build-index.js";

export interface RankOptions {
  /** Term-frequency saturation. Higher means repeated terms keep helping. */
  k1: number;
  /** Length normalisation, 0 to 1. Higher penalises long chunks harder. */
  b: number;
  /** Multiplier applied to a term appearing in the chunk's own heading. */
  headingBoost: number;
  /**
   * Multiplier for a term inherited from an ancestor heading. Body weight by
   * default: a subsection under "## stdio" is genuinely about stdio, but not as
   * much as the section titled that, and at heading weight a short subsection
   * containing the word nowhere in its own text would outrank it.
   */
  ancestorBoost: number;
}

export const BM25_DEFAULTS: RankOptions = {
  k1: 1.2,
  b: 0.75,
  headingBoost: 2,
  ancestorBoost: 1,
};

export interface ScoredChunk {
  chunk: IndexedChunk;
  score: number;
  /** Query terms that contributed, in query order -- 2.5 centres snippets on these. */
  matched: string[];
}

/**
 * Uses the smoothed variant, `ln(1 + (N - df + 0.5) / (df + 0.5))`, rather than
 * the textbook form. The textbook idf turns negative once a term appears in
 * more than half the corpus, which lets a common word *subtract* from a score.
 * This one decays toward zero instead, so a ubiquitous term simply stops
 * mattering.
 */
export function inverseDocumentFrequency(index: Index, term: string): number {
  const df = documentFrequency(index, term);
  if (df === 0) return 0;
  return Math.log(1 + (index.size - df + 0.5) / (df + 0.5));
}

export function rank(
  index: Index,
  queryTokens: string[],
  options: Partial<RankOptions> = {},
): ScoredChunk[] {
  const { k1, b, headingBoost, ancestorBoost } = { ...BM25_DEFAULTS, ...options };
  if (index.size === 0) return [];

  const terms = [...new Set(queryTokens)];
  const scores = new Map<number, number>();
  const matches = new Map<number, Set<string>>();

  for (const term of terms) {
    const postings = index.postings.get(term);
    if (postings === undefined) continue;

    const idf = inverseDocumentFrequency(index, term);

    for (const posting of postings) {
      const chunk = index.chunks[posting.chunk];
      if (chunk === undefined) continue;

      const tf =
        posting.bodyTf +
        headingBoost * posting.headingTf +
        ancestorBoost * posting.ancestorTf;
      if (tf === 0) continue;

      const norm = k1 * (1 - b + (b * chunk.length) / index.avgdl);
      const contribution = idf * ((tf * (k1 + 1)) / (tf + norm));

      scores.set(posting.chunk, (scores.get(posting.chunk) ?? 0) + contribution);

      let matched = matches.get(posting.chunk);
      if (matched === undefined) {
        matched = new Set<string>();
        matches.set(posting.chunk, matched);
      }
      matched.add(term);
    }
  }

  const results: ScoredChunk[] = [];
  for (const [position, score] of scores) {
    const chunk = index.chunks[position];
    if (chunk === undefined || score <= 0) continue;
    const matched = matches.get(position) ?? new Set<string>();
    results.push({
      chunk,
      score,
      matched: terms.filter((term) => matched.has(term)),
    });
  }

  results.sort(compareResults);
  return results;
}

/** Score descending, then path, then position in the file -- never insertion
 * order, so a rebuild cannot quietly reshuffle equal-scoring hits. */
function compareResults(a: ScoredChunk, b: ScoredChunk): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.chunk.path !== b.chunk.path) return a.chunk.path < b.chunk.path ? -1 : 1;
  return a.chunk.startLine - b.chunk.startLine;
}
