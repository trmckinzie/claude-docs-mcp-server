/**
 * Inverted index over chunks. Pure: hand it parsed documents, get back the
 * counts BM25 needs. See PLAN.md step 2.3.
 *
 * The retrievable unit is the chunk, not the document, so "document frequency"
 * here means the number of *chunks* carrying a term.
 */

import type { Chunk, ParsedDoc } from "./parse-doc.js";
import { tokenize } from "./tokenize.js";

export interface Posting {
  /** Position in `Index.chunks`. */
  chunk: number;
  /** Occurrences in the chunk body. */
  bodyTf: number;
  /** Occurrences in the chunk's own heading. */
  headingTf: number;
  /**
   * Occurrences in an ancestor heading only. Kept apart from `headingTf`
   * because a subsection inherits its parent's topic far more weakly than the
   * section actually titled that -- see the boosts in `rank.ts`.
   */
  ancestorTf: number;
}

export interface IndexedChunk extends Chunk {
  /** Denormalised from the parent document so a hit renders without a lookup. */
  title: string;
  /** Token count, body plus headings, for BM25 length normalisation. */
  length: number;
}

export interface Index {
  chunks: IndexedChunk[];
  /** Term to postings, keys in sorted order, postings in chunk order. */
  postings: Map<string, Posting[]>;
  /** Number of chunks -- N in the BM25 idf term. */
  size: number;
  /** Mean chunk length in tokens; 0 for an empty corpus. */
  avgdl: number;
}

/** Number of chunks containing `term`. Derived from the postings rather than
 * stored alongside them, so the two can never drift apart. */
export function documentFrequency(index: Index, term: string): number {
  return index.postings.get(term)?.length ?? 0;
}

type Field = "bodyTf" | "headingTf" | "ancestorTf";

export function buildIndex(docs: ParsedDoc[]): Index {
  const chunks: IndexedChunk[] = [];
  const accumulator = new Map<string, Map<number, Posting>>();

  for (const doc of docs) {
    for (const chunk of doc.chunks) {
      const bodyTokens = tokenize(chunk.text);
      const headingTokens = chunk.heading === null ? [] : tokenize(chunk.heading);
      // Ancestors still count, so "### Framing" under "## stdio" remains
      // findable by "stdio" -- just not as strongly as the stdio section itself.
      const ancestorTokens = chunk.headingPath
        .slice(0, -1)
        .flatMap((heading) => tokenize(heading));

      const position = chunks.length;
      chunks.push({
        ...chunk,
        title: doc.title,
        length: bodyTokens.length + headingTokens.length + ancestorTokens.length,
      });

      accumulate(accumulator, bodyTokens, position, "bodyTf");
      accumulate(accumulator, headingTokens, position, "headingTf");
      accumulate(accumulator, ancestorTokens, position, "ancestorTf");
    }
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

  return {
    chunks,
    postings: canonicalise(accumulator),
    size: chunks.length,
    avgdl: chunks.length === 0 ? 0 : totalLength / chunks.length,
  };
}

function accumulate(
  accumulator: Map<string, Map<number, Posting>>,
  tokens: string[],
  position: number,
  field: Field,
): void {
  for (const token of tokens) {
    let byChunk = accumulator.get(token);
    if (byChunk === undefined) {
      byChunk = new Map<number, Posting>();
      accumulator.set(token, byChunk);
    }

    let posting = byChunk.get(position);
    if (posting === undefined) {
      posting = { chunk: position, bodyTf: 0, headingTf: 0, ancestorTf: 0 };
      byChunk.set(position, posting);
    }

    posting[field] += 1;
  }
}

/**
 * Sorts terms by code point and postings by chunk. Insertion order would
 * already be stable for identical input, but a canonical order makes two builds
 * comparable byte for byte and keeps debug output readable.
 *
 * Deliberately not `localeCompare` -- that varies with the host's ICU data, and
 * this index has to be reproducible.
 */
function canonicalise(
  accumulator: Map<string, Map<number, Posting>>,
): Map<string, Posting[]> {
  const terms = [...accumulator.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const postings = new Map<string, Posting[]>();
  for (const term of terms) {
    const byChunk = accumulator.get(term);
    if (byChunk === undefined) continue;
    postings.set(
      term,
      [...byChunk.values()].sort((a, b) => a.chunk - b.chunk),
    );
  }
  return postings;
}
