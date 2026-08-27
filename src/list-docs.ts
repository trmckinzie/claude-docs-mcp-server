/**
 * Corpus discovery over an already-built index: what sections exist, and
 * what documents live in each one. Pure: takes an `Index`, returns data --
 * no fs, same split as `search.ts`. See PLAN.md step 2.9.
 *
 * The topic-organized directory layout (`claude-code/`, `platform/`, ...)
 * was given to the corpus for free at step 2.6.5; this is what exposes it,
 * without building the fuller fundamentals/advanced browse tool PLAN.md
 * flags as its own, deliberately-deferred scope-creep risk.
 */

import type { Index } from "./build-index.js";

/** A document's section is the first `/`-segment of its path. */
function section(path: string): string {
  return path.split("/")[0] ?? path;
}

export interface SectionSummary {
  section: string;
  count: number;
}

export interface DocSummary {
  path: string;
  title: string;
}

/** One row per distinct document under `index`, deduped from chunks --
 * chunks from the same document are contiguous and share a title, since
 * `build-index.ts` denormalises it onto every chunk. */
function documents(index: Index): DocSummary[] {
  const byPath = new Map<string, string>();
  for (const chunk of index.chunks) {
    if (!byPath.has(chunk.path)) byPath.set(chunk.path, chunk.title);
  }
  return [...byPath.entries()]
    .map(([path, title]) => ({ path, title }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Every section present in the corpus, with how many documents it has. */
export function listSections(index: Index): SectionSummary[] {
  const counts = new Map<string, number>();
  for (const doc of documents(index)) {
    const s = section(doc.path);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([sectionName, count]) => ({ section: sectionName, count }))
    .sort((a, b) => (a.section < b.section ? -1 : a.section > b.section ? 1 : 0));
}

/** Every document under `sectionName`, or `[]` for a section with none --
 * an unrecognised section is a normal outcome here, not an error. */
export function listDocuments(index: Index, sectionName: string): DocSummary[] {
  return documents(index).filter((doc) => section(doc.path) === sectionName);
}
