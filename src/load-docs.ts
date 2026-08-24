/**
 * Reads a directory of Markdown into parsed documents. The one impure module
 * in the pipeline -- everything downstream of this (parse-doc, tokenize,
 * build-index, rank, search) is a pure function. See PLAN.md step 2.6.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { parseDoc } from "./parse-doc.js";
import type { ParsedDoc } from "./parse-doc.js";

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    // docs/ is gitignored (see PLAN.md "Decisions") and only populated by the
    // 2.6.5 fetch step, so a fresh clone must still start the server.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".md") ? [full] : [];
    }),
  );
  return nested.flat();
}

/** Loads every Markdown file under `rootDir`, sorted by path for determinism. */
export async function loadDocs(rootDir: string): Promise<ParsedDoc[]> {
  const files = await walk(rootDir);
  const docs = await Promise.all(
    files.map(async (file) => {
      const raw = await readFile(file, "utf8");
      const path = relative(rootDir, file).split(sep).join("/");
      return parseDoc(raw, path);
    }),
  );
  return docs.sort((a, b) => a.path.localeCompare(b.path));
}
