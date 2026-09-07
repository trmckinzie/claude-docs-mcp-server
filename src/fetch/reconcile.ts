/**
 * Reconciles the manifest against what is actually on disk, in both
 * directions: which docs have to be written, and which have to be removed.
 *
 * A content-hash diff alone is not enough, because the manifest and the corpus
 * have different lifetimes: `docs.manifest.json` is committed, `docs/` is
 * gitignored (see PLAN.md "Decisions"). A fresh clone therefore starts with a
 * complete manifest and an empty corpus, and every path diffs as *unchanged* --
 * so selecting writes from `added`/`updated` alone wrote nothing at all, and
 * the fetch reported success over an empty `docs/`. It could not even
 * self-heal: the manifest was rewritten still claiming every file existed.
 *
 * The manifest answers "did the source change." Only the filesystem answers
 * "is it actually here." This reconciles the two. Pure: no fs, no network --
 * `scripts/fetch-docs.ts` supplies what it found on disk.
 */

export interface WriteSelectionDiff {
  added: readonly string[];
  updated: readonly string[];
  unchanged: readonly string[];
}

/**
 * Returns every path needing a write, sorted and deduplicated: everything
 * added or updated, plus any unchanged path whose file is missing from disk.
 */
export function selectPathsToWrite(
  diff: WriteSelectionDiff,
  presentOnDisk: ReadonlySet<string>,
): string[] {
  const needed = new Set<string>([...diff.added, ...diff.updated]);
  for (const path of diff.unchanged) {
    if (!presentOnDisk.has(path)) needed.add(path);
  }
  return sorted(needed);
}

/**
 * Returns every file on disk that the fresh manifest does not list.
 *
 * Deleting only the diff's `gone` paths is not enough to keep `docs/` a true
 * mirror: a run interrupted between writing the manifest and pruning drops a
 * path from the manifest while leaving the file on disk, after which it never
 * appears in any future diff and is served stale forever. The fresh manifest
 * is the complete statement of what belongs in `docs/`, so anything else
 * under it is an orphan -- which also covers `gone` paths, hand-dropped
 * files, and leftovers from a renamed source.
 */
export function selectOrphanedPaths(
  manifestPaths: readonly string[],
  onDiskPaths: readonly string[],
): string[] {
  const expected = new Set(manifestPaths);
  return sorted(new Set(onDiskPaths.filter((path) => !expected.has(path))));
}

function sorted(paths: ReadonlySet<string>): string[] {
  return [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
