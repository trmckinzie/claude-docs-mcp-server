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
