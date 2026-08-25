/**
 * Diffs a freshly fetched set of docs against the previous manifest. Pure:
 * no fs, no network -- `scripts/fetch-docs.ts` owns reading and writing
 * `docs.manifest.json` on disk. See PLAN.md step 2.6.5.
 */

export type SourceSite = "code" | "platform" | "support";

export interface ManifestEntry {
  /** Path under `docs/`, POSIX-separated. */
  path: string;
  sourceUrl: string;
  sourceSite: SourceSite;
  fetchedAt: string;
  contentHash: string;
  /** Only populated for sources that expose one, e.g. the Help Center sitemap. */
  sourceLastMod?: string;
}

export interface ManifestDiff {
  added: string[];
  updated: string[];
  unchanged: string[];
  /** Present in the previous manifest, absent from the fresh fetch. */
  gone: string[];
  /** The manifest to write: fresh entries, with unchanged ones keeping their
   * original `fetchedAt` rather than being re-stamped for no reason. */
  manifest: ManifestEntry[];
}

export function diffManifest(
  previous: readonly ManifestEntry[],
  fresh: readonly ManifestEntry[],
): ManifestDiff {
  const previousByPath = new Map(previous.map((entry) => [entry.path, entry]));
  const freshPaths = new Set(fresh.map((entry) => entry.path));

  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const manifest: ManifestEntry[] = [];

  for (const entry of fresh) {
    const before = previousByPath.get(entry.path);
    if (before === undefined) {
      added.push(entry.path);
      manifest.push(entry);
    } else if (before.contentHash === entry.contentHash) {
      unchanged.push(entry.path);
      manifest.push(before);
    } else {
      updated.push(entry.path);
      manifest.push(entry);
    }
  }

  const gone = previous
    .map((entry) => entry.path)
    .filter((path) => !freshPaths.has(path));

  const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    added: added.sort(byPath),
    updated: updated.sort(byPath),
    unchanged: unchanged.sort(byPath),
    gone: gone.sort(byPath),
    manifest: manifest.sort((a, b) => byPath(a.path, b.path)),
  };
}
