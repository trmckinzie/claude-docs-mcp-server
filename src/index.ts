#!/usr/bin/env node
/**
 * Entry point: load the corpus, build the index, and serve it over stdio.
 *
 * This file is the I/O edge the rest of the pipeline was built to keep clean
 * of -- everything it calls into is pure or isolated I/O, so this is the one
 * module with no unit tests of its own. See PLAN.md step 2.7 for the manual
 * smoke test that stands in for one.
 *
 * stdout carries only MCP protocol frames, written by the SDK transport.
 * Nothing in this file, or anything it calls, may write to it directly --
 * console.log here would silently corrupt the stream. Diagnostics go to
 * stderr via console.error.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildIndex } from "./build-index.js";
import type { ChangelogEntry } from "./fetch/changelog.js";
import { loadDocs } from "./load-docs.js";
import { createServer } from "./server.js";

const docsDir = fileURLToPath(new URL("../docs/", import.meta.url));
const changelogPath = fileURLToPath(new URL("../docs.changelog.json", import.meta.url));

const docs = await loadDocs(docsDir);
const index = buildIndex(docs);

if (index.size === 0) {
  console.error(
    `claude-mcp-server: no indexable content under ${docsDir} -- ` +
      "run the fetch step (PLAN.md 2.6.5) or point docs/ at a real corpus.",
  );
}

let changelog: ChangelogEntry[] = [];
try {
  changelog = JSON.parse(await readFile(changelogPath, "utf8")) as ChangelogEntry[];
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const server = createServer(index, changelog);
await server.connect(new StdioServerTransport());

console.error(
  `claude-mcp-server: serving ${String(index.size)} chunks from ${String(docs.length)} documents`,
);
