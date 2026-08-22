import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface RawDoc {
  /** Path relative to the fixture root, always POSIX-separated. */
  path: string;
  raw: string;
}

/**
 * `corpus` is the stable ground truth for index and ranking assertions.
 * `edge-cases` is parser-only: keeping it separate means an empty or malformed
 * file can never perturb avgdl, and therefore never shift a BM25 score.
 */
export type FixtureSet = "corpus" | "edge-cases";

const FIXTURES_ROOT = fileURLToPath(new URL(".", import.meta.url));

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".md") ? [full] : [];
    }),
  );
  return nested.flat();
}

/** Loads a fixture set, sorted by path so callers always get a stable order. */
export async function loadFixtures(set: FixtureSet): Promise<RawDoc[]> {
  const root = join(FIXTURES_ROOT, set);
  const files = await walk(root);
  const docs = await Promise.all(
    files.map(async (file) => ({
      path: relative(root, file).split(sep).join("/"),
      raw: await readFile(file, "utf8"),
    })),
  );
  return docs.sort((a, b) => a.path.localeCompare(b.path));
}
