/**
 * Deletes docs that dropped out of the fresh fetch (`ManifestDiff.gone`)
 * from disk, so `docs/` stays a true mirror of the live sources rather than
 * accumulating stale pages a since-removed or renamed source no longer
 * serves. Consistent with PLAN.md's "docs/ is a cache... read-only by
 * convention... a refresh overwrites it" decision -- a gone path is exactly
 * the case a refresh should overwrite to nothing.
 *
 * Every path is re-checked with `isPathInsideDocs` before deletion, even
 * though it originated from a manifest this same process just wrote --
 * defense in depth against a hand-edited or corrupted manifest naming a path
 * outside `docs/`.
 */

import { rm } from "node:fs/promises";
import { join } from "node:path";
import { isPathInsideDocs } from "./url-safety.js";

export interface PruneResult {
  /** Paths successfully removed (or already absent). */
  deleted: string[];
  /** Paths refused because they failed the inside-`docs/` safety check. */
  skipped: string[];
}

export async function pruneGoneDocs(
  docsRoot: string,
  gonePaths: readonly string[],
): Promise<PruneResult> {
  const deleted: string[] = [];
  const skipped: string[] = [];

  for (const path of gonePaths) {
    if (!isPathInsideDocs(docsRoot, path)) {
      skipped.push(path);
      continue;
    }

    try {
      await rm(join(docsRoot, path));
      deleted.push(path);
    } catch (error) {
      // Already gone (e.g. a prior run deleted it but crashed before
      // recording the manifest) -- not a caller-facing failure.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        deleted.push(path);
        continue;
      }
      throw error;
    }
  }

  return { deleted, skipped };
}
