/**
 * A running history of `diffManifest` results, so "what changed" is
 * answerable without re-diffing two manifests by hand. Pure: no fs, no
 * network -- `scripts/fetch-docs.ts` owns reading and writing
 * `docs.changelog.json` on disk, same split as `manifest.ts`. See PLAN.md
 * step 2.8.
 */

/** A trimmed `ManifestDiff`: `unchanged` isn't interesting here, and
 * `manifest` is `docs.manifest.json`'s job, not the changelog's. */
export interface ChangelogEntry {
  fetchedAt: string;
  added: string[];
  updated: string[];
  gone: string[];
}

/** Appends `entry`, dropping the oldest entries once `previous` plus `entry`
 * exceeds `max` -- otherwise the changelog would grow without bound. */
export function appendEntry(
  previous: readonly ChangelogEntry[],
  entry: ChangelogEntry,
  max: number,
): ChangelogEntry[] {
  return [...previous, entry].slice(-max);
}

const NO_CHANGES_MESSAGE = "No changes recorded yet.";

function isNoop(entry: ChangelogEntry): boolean {
  return entry.added.length === 0 && entry.updated.length === 0 && entry.gone.length === 0;
}

function formatEntry(entry: ChangelogEntry): string {
  const lines = [entry.fetchedAt];
  if (entry.added.length > 0) lines.push(`  added: ${entry.added.join(", ")}`);
  if (entry.updated.length > 0) lines.push(`  updated: ${entry.updated.join(", ")}`);
  if (entry.gone.length > 0) lines.push(`  gone: ${entry.gone.join(", ")}`);
  return lines.join("\n");
}

/** Formats the most recent `limit` entries, newest first, for direct return
 * from the `recent_changes` MCP tool. A no-op fetch (nothing added, updated,
 * or gone) is dropped rather than cluttering the digest with empty entries. */
export function summarizeChanges(entries: readonly ChangelogEntry[], limit: number): string {
  const recent = entries.slice(-limit).filter((entry) => !isNoop(entry)).reverse();
  if (recent.length === 0) return NO_CHANGES_MESSAGE;
  return recent.map(formatEntry).join("\n\n");
}
