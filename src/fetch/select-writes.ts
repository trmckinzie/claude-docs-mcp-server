/**
 * Decides which fetched docs actually have to be written to disk.
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
  return [...needed].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
