/**
 * Detects two distinct fetched records reducing to the same on-disk path
 * (e.g. a duplicate or migrated Help Center article sharing a slug). Pure:
 * no fs, no network. See PLAN.md 2.6.5.
 */

/** Returns the paths that appear more than once in `paths`, sorted and
 * deduplicated. An empty result means every path is unique. */
export function findDuplicatePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const collided = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) collided.add(path);
    seen.add(path);
  }
  return [...collided].sort();
}

/** The fields that decide whether two fetched records are the same record. */
interface DocIdentity {
  readonly path: string;
  readonly sourceUrl: string;
  readonly title: string;
  readonly body: string;
}

/** Drops a record only when an earlier one has the same path, source URL,
 * title and body -- an upstream index listing one page twice (seen
 * 2026-10-09 in code.claude.com's llms-full.txt). Anything that differs in
 * any of those is kept, so a real collision still reaches
 * findDuplicatePaths and still fails the run. Order is preserved. */
export function dropIdenticalDuplicates<T extends DocIdentity>(docs: readonly T[]): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const doc of docs) {
    const key = JSON.stringify([doc.path, doc.sourceUrl, doc.title, doc.body]);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(doc);
  }
  return kept;
}
