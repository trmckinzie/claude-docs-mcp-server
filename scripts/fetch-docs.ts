#!/usr/bin/env node
/**
 * Rebuilds `docs/` from the live sources. The one place this project makes a
 * network request. See PLAN.md step 2.6.5 and the "Decisions" section on why
 * `docs/` is a cache, not a work product.
 *
 * All I/O and orchestration; the risky logic (record splitting, scope
 * filtering, manifest diffing, URL/path safety) lives in tested pure modules
 * under `src/fetch/`. No unit tests of its own by design, same as
 * `src/index.ts` -- verified instead by running it for real (PLAN.md 2.6.5
 * Verification) and by `npm run typecheck`.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyHelpCenterArticle } from "../src/fetch/help-center-scope.js";
import type { ManifestEntry } from "../src/fetch/manifest.js";
import { computeContentHash, diffManifest } from "../src/fetch/manifest.js";
import { parseLlmsFull } from "../src/fetch/parse-llms-full.js";
import { parsePlatformLlmsFull } from "../src/fetch/parse-platform-llms-full.js";
import { isInPlatformScope } from "../src/fetch/platform-scope.js";
import { assertSafeFetchUrl, isPathInsideDocs } from "../src/fetch/url-safety.js";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOCS_ROOT = join(PROJECT_ROOT, "docs");
const MANIFEST_PATH = join(PROJECT_ROOT, "docs.manifest.json");

const FETCH_TIMEOUT_MS = 30_000;
/** Comfortably above the largest real file seen while designing this (the
 * ~40MB platform llms-full.txt), while still bounding a runaway response. */
const MAX_RESPONSE_BYTES = 200 * 1024 * 1024;

interface FetchedDoc {
  path: string;
  sourceUrl: string;
  sourceSite: ManifestEntry["sourceSite"];
  title: string;
  body: string;
}

/** Enforces the host allowlist, HTTPS, a timeout, and a response-size cap.
 * `docs.ts` under CLAUDE.md's Conventions names this pattern as standing,
 * not specific to this one script. */
async function fetchTextSafely(url: string): Promise<string> {
  assertSafeFetchUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${String(response.status)} ${response.statusText} fetching ${url}`);
    }
    if (response.body === null) return "";

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(`Response for ${url} exceeded ${String(MAX_RESPONSE_BYTES)} bytes`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    clearTimeout(timeout);
  }
}

function toFrontmatterDoc(title: string, sourceUrl: string, fetchedAt: string, body: string): string {
  const updated = fetchedAt.slice(0, 10);
  const escapedTitle = title.replace(/"/g, '\\"');
  return `---\ntitle: "${escapedTitle}"\nsource_url: ${sourceUrl}\nupdated: ${updated}\n---\n\n${body}\n`;
}

/** `https://code.claude.com/docs/en/agent-sdk/overview` -> `agent-sdk/overview.md` */
function stripDocsEnPrefix(sourceUrl: string): string {
  const path = new URL(sourceUrl).pathname.replace(/^\/docs\/en\//, "");
  return `${path}.md`;
}

async function fetchCodeDocs(): Promise<FetchedDoc[]> {
  const text = await fetchTextSafely("https://code.claude.com/docs/llms-full.txt");
  return parseLlmsFull(text).map((record) => ({
    path: `claude-code/${stripDocsEnPrefix(record.sourceUrl)}`,
    sourceUrl: record.sourceUrl,
    sourceSite: "code" as const,
    title: record.title,
    body: record.body,
  }));
}

async function fetchPlatformDocs(): Promise<FetchedDoc[]> {
  const text = await fetchTextSafely("https://platform.claude.com/llms-full.txt");
  return parsePlatformLlmsFull(text)
    .filter((record) => isInPlatformScope(record.sourceUrl))
    .map((record) => ({
      path: `platform/${stripDocsEnPrefix(record.sourceUrl)}`,
      sourceUrl: record.sourceUrl,
      sourceSite: "platform" as const,
      title: record.title,
      body: record.body,
    }));
}

const ARTICLE_LINK_RE =
  /href="(https:\/\/support\.claude\.com\/en\/articles\/[0-9]+-[a-z0-9-]*)"/g;

/** No collections API exists on this Help Center (confirmed at design time);
 * the homepage's own links are the discovery mechanism. */
async function discoverHelpCenterArticles(): Promise<string[]> {
  const html = await fetchTextSafely("https://support.claude.com/en/");
  const urls = new Set<string>();
  for (const match of html.matchAll(ARTICLE_LINK_RE)) {
    const url = match[1];
    if (url !== undefined) urls.add(url);
  }
  return [...urls];
}

function firstHeadingOrFallback(body: string, url: string): string {
  const heading = /^#\s+(.+)$/m.exec(body);
  if (heading?.[1] !== undefined) return heading[1].trim();
  const slug = new URL(url).pathname.split("/").pop() ?? "";
  return slug.replace(/^[0-9]+-/, "").replace(/-/g, " ");
}

/** Bounded concurrency: enough to not pay ~350 round-trips serially, low
 * enough not to hammer a real third-party Help Center with one burst. */
const HELP_CENTER_FETCH_CONCURRENCY = 6;

async function fetchHelpCenterDocs(): Promise<FetchedDoc[]> {
  const inScope: Array<{ url: string; collection: string }> = [];
  for (const url of await discoverHelpCenterArticles()) {
    const collection = classifyHelpCenterArticle(url);
    if (collection !== null) inScope.push({ url, collection });
  }

  const docs: FetchedDoc[] = [];
  for (let i = 0; i < inScope.length; i += HELP_CENTER_FETCH_CONCURRENCY) {
    const batch = inScope.slice(i, i + HELP_CENTER_FETCH_CONCURRENCY);
    const fetched = await Promise.all(
      batch.map(async ({ url, collection }): Promise<FetchedDoc> => {
        const body = await fetchTextSafely(`${url}.md`);
        const slug = new URL(url).pathname.split("/").pop()?.replace(/^[0-9]+-/, "") ?? "unknown";
        return {
          path: `${collection}/${slug}.md`,
          sourceUrl: url,
          sourceSite: "support",
          title: firstHeadingOrFallback(body, url),
          body,
        };
      }),
    );
    docs.push(...fetched);
  }

  return docs;
}

async function loadPreviousManifest(): Promise<ManifestEntry[]> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    return JSON.parse(raw) as ManifestEntry[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeDoc(path: string, contents: string): Promise<void> {
  if (!isPathInsideDocs(DOCS_ROOT, path)) {
    throw new Error(`Refusing to write outside docs/: ${path}`);
  }
  const fullPath = join(DOCS_ROOT, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, contents, "utf8");
}

async function main(): Promise<void> {
  const fetchedAt = new Date().toISOString();

  console.error("Fetching code.claude.com...");
  const codeDocs = await fetchCodeDocs();
  console.error(`  ${String(codeDocs.length)} pages`);

  console.error("Fetching platform.claude.com (curated slice)...");
  const platformDocs = await fetchPlatformDocs();
  console.error(`  ${String(platformDocs.length)} pages`);

  console.error("Fetching support.claude.com (Cowork/Desktop/Chrome/Mobile)...");
  const helpCenterDocs = await fetchHelpCenterDocs();
  console.error(`  ${String(helpCenterDocs.length)} articles`);

  const allDocs = [...codeDocs, ...platformDocs, ...helpCenterDocs];

  const freshEntries: ManifestEntry[] = allDocs.map((doc) => ({
    path: doc.path,
    sourceUrl: doc.sourceUrl,
    sourceSite: doc.sourceSite,
    fetchedAt,
    contentHash: computeContentHash(doc.title, doc.body),
  }));

  const previousManifest = await loadPreviousManifest();
  const diff = diffManifest(previousManifest, freshEntries);

  const docsByPath = new Map(allDocs.map((doc) => [doc.path, doc]));
  if (docsByPath.size !== allDocs.length) {
    // Two distinct articles reducing to the same slug (e.g. a duplicate or
    // migrated Help Center article) would otherwise silently overwrite one
    // another here, with the manifest still recording both as separate
    // entries -- report it rather than losing content without a trace.
    const seen = new Set<string>();
    const collided = new Set<string>();
    for (const doc of allDocs) {
      if (seen.has(doc.path)) collided.add(doc.path);
      seen.add(doc.path);
    }
    console.error(
      `warning: ${String(collided.size)} path collision(s), only the last source wins on disk: ${[...collided].join(", ")}`,
    );
  }

  const changedPaths = new Set([...diff.added, ...diff.updated]);
  await Promise.all(
    [...changedPaths].map(async (path) => {
      const doc = docsByPath.get(path);
      if (doc === undefined) return;
      await writeDoc(path, toFrontmatterDoc(doc.title, doc.sourceUrl, fetchedAt, doc.body));
    }),
  );

  await writeFile(MANIFEST_PATH, `${JSON.stringify(diff.manifest, null, 2)}\n`, "utf8");

  console.error();
  console.error(`added:     ${String(diff.added.length)}`);
  console.error(`updated:   ${String(diff.updated.length)}`);
  console.error(`unchanged: ${String(diff.unchanged.length)}`);
  console.error(`gone:      ${String(diff.gone.length)}`);
  if (diff.gone.length > 0) {
    console.error("  (files remain on disk; delete manually if you want them gone)");
  }
}

await main();
