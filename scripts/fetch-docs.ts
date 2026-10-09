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

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { appendEntry } from "../src/fetch/changelog.js";
import type { ChangelogEntry } from "../src/fetch/changelog.js";
import { dropIdenticalDuplicates, findDuplicatePaths } from "../src/fetch/collisions.js";
import { extractArticleUrls, findVanishedSites } from "../src/fetch/help-center-discovery.js";
import { classifyHelpCenterArticle } from "../src/fetch/help-center-scope.js";
import type { ManifestEntry } from "../src/fetch/manifest.js";
import { carryForwardEntries, computeContentHash, diffManifest } from "../src/fetch/manifest.js";
import { parseLlmsFull } from "../src/fetch/parse-llms-full.js";
import { parsePlatformLlmsFull } from "../src/fetch/parse-platform-llms-full.js";
import { isInPlatformScope } from "../src/fetch/platform-scope.js";
import { pruneGoneDocs } from "../src/fetch/prune.js";
import { selectOrphanedPaths, selectPathsToWrite } from "../src/fetch/reconcile.js";
import { fetchWithSafeRedirects } from "../src/fetch/safe-fetch.js";
import { assertSafeFetchUrl, isPathInsideDocs } from "../src/fetch/url-safety.js";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOCS_ROOT = join(PROJECT_ROOT, "docs");
const MANIFEST_PATH = join(PROJECT_ROOT, "docs.manifest.json");
const CHANGELOG_PATH = join(PROJECT_ROOT, "docs.changelog.json");
/** Roughly one entry per practical re-fetch cadence -- bounds the file
 * without needing every sync ever run to answer "what's new." */
const CHANGELOG_MAX_ENTRIES = 20;

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
 * not specific to this one script. Redirects are not followed transparently
 * -- plain `fetch` would let a server on the allowlist redirect off it
 * without `assertSafeFetchUrl` ever seeing the real destination, so each hop
 * is re-validated before it's followed. */
async function fetchTextSafely(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchWithSafeRedirects(url, {
      validate: assertSafeFetchUrl,
      signal: controller.signal,
    });
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


/** No collections API exists on this Help Center (confirmed at design time);
 * the homepage's own links are the discovery mechanism. */
async function discoverHelpCenterArticles(): Promise<string[]> {
  return extractArticleUrls(await fetchTextSafely("https://support.claude.com/en/"));
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

function helpCenterPath(url: string, collection: string): string {
  const slug = new URL(url).pathname.split("/").pop()?.replace(/^[0-9]+-/, "") ?? "unknown";
  return `${collection}/${slug}.md`;
}

interface HelpCenterResult {
  docs: FetchedDoc[];
  /** Intended on-disk paths whose article could not be fetched this run. The
   * path is derived from the URL before fetching, so it is known even for a
   * failure -- which is what lets `carryForwardEntries` protect it. */
  failedPaths: string[];
}

/**
 * One article failing must not fail the run, and must not look like a
 * deletion. The Help Center is a third party that renames and unpublishes
 * articles between the homepage scrape and the fetch, so a rejection here is
 * routine rather than exceptional; aborting discarded the 250 already-fetched
 * code and platform pages with it. Failures are collected instead and their
 * paths protected downstream. A total failure still throws -- that is a
 * systemic problem, not one missing article, and should not exit 0.
 */
async function fetchHelpCenterDocs(): Promise<HelpCenterResult> {
  const inScope: Array<{ url: string; collection: string }> = [];
  for (const url of await discoverHelpCenterArticles()) {
    const collection = classifyHelpCenterArticle(url);
    if (collection !== null) inScope.push({ url, collection });
  }

  const docs: FetchedDoc[] = [];
  const failedPaths: string[] = [];
  for (let i = 0; i < inScope.length; i += HELP_CENTER_FETCH_CONCURRENCY) {
    const batch = inScope.slice(i, i + HELP_CENTER_FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async ({ url, collection }): Promise<FetchedDoc> => {
        const body = await fetchTextSafely(`${url}.md`);
        return {
          path: helpCenterPath(url, collection),
          sourceUrl: url,
          sourceSite: "support",
          title: firstHeadingOrFallback(body, url),
          body,
        };
      }),
    );

    settled.forEach((outcome, index) => {
      const source = batch[index];
      if (source === undefined) return;
      if (outcome.status === "fulfilled") {
        docs.push(outcome.value);
        return;
      }
      failedPaths.push(helpCenterPath(source.url, source.collection));
      console.error(`  warning: ${source.url} failed: ${String(outcome.reason)}`);
    });
  }

  if (inScope.length > 0 && docs.length === 0) {
    throw new Error(
      `All ${String(inScope.length)} Help Center articles failed to fetch -- refusing to treat that as an empty collection`,
    );
  }

  return { docs, failedPaths };
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

async function loadPreviousChangelog(): Promise<ChangelogEntry[]> {
  try {
    const raw = await readFile(CHANGELOG_PATH, "utf8");
    return JSON.parse(raw) as ChangelogEntry[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** Every Markdown file actually under `docs/` right now, as POSIX-relative
 * paths. The manifest only reports what the *source* did; this reports what
 * the disk has, which is what both halves of the reconciliation need -- files
 * missing from disk get rewritten, files missing from the manifest get
 * removed. Walks rather than stat-ing the manifest's paths, because an orphan
 * is by definition a file the manifest does not name. */
async function listDocPathsOnDisk(dir = DOCS_ROOT): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return listDocPathsOnDisk(full);
      return entry.name.endsWith(".md") ? [relative(DOCS_ROOT, full).split(sep).join("/")] : [];
    }),
  );
  return nested.flat();
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
  const helpCenter = await fetchHelpCenterDocs();
  console.error(`  ${String(helpCenter.docs.length)} articles`);
  if (helpCenter.failedPaths.length > 0) {
    console.error(
      `  ${String(helpCenter.failedPaths.length)} article(s) failed; keeping their existing copies`,
    );
  }

  // Byte-identical repeats in an upstream index are one record, not a
  // collision; anything else that shares a path still fails below.
  const allDocs = dropIdenticalDuplicates([...codeDocs, ...platformDocs, ...helpCenter.docs]);

  const freshEntries: ManifestEntry[] = allDocs.map((doc) => ({
    path: doc.path,
    sourceUrl: doc.sourceUrl,
    sourceSite: doc.sourceSite,
    fetchedAt,
    contentHash: computeContentHash(doc.title, doc.body),
  }));

  const previousManifest = await loadPreviousManifest();
  // Checked before anything is diffed or deleted: a source that returned
  // nothing would otherwise read as "every page removed upstream".
  const vanished = findVanishedSites(previousManifest, freshEntries);
  if (vanished.length > 0) {
    throw new Error(
      `No pages fetched from ${vanished.join(", ")}, which had pages last run -- refusing to treat that as a deletion`,
    );
  }
  // A failed article is "unknown," not "deleted" -- carrying its previous
  // entry forward keeps it out of `gone`, so a transient error cannot delete
  // real content off disk.
  const reconciledEntries = carryForwardEntries(
    freshEntries,
    previousManifest,
    helpCenter.failedPaths,
  );
  const diff = diffManifest(previousManifest, reconciledEntries);

  // Two distinct articles reducing to the same slug (e.g. a duplicate or
  // migrated Help Center article) would otherwise silently overwrite one
  // another on disk, with the manifest still recording both as separate
  // entries -- a hard failure beats a quiet, undetectable content loss.
  const collided = findDuplicatePaths(allDocs.map((doc) => doc.path));
  if (collided.length > 0) {
    throw new Error(
      `${String(collided.length)} path collision(s), refusing to write: ${collided.join(", ")}`,
    );
  }

  const docsByPath = new Map(allDocs.map((doc) => [doc.path, doc]));

  // Not just added+updated: the manifest is committed while docs/ is
  // gitignored, so a fresh clone diffs every path as "unchanged" against a
  // corpus that isn't there. Only the filesystem can answer that, so the
  // manifest diff is reconciled against what's actually on disk.
  const onDisk = await listDocPathsOnDisk();
  const pathsToWrite = selectPathsToWrite(diff, new Set(onDisk));
  const restored = pathsToWrite.length - (diff.added.length + diff.updated.length);
  if (restored > 0) {
    console.error(`  restoring ${String(restored)} unchanged file(s) missing from docs/`);
  }

  await Promise.all(
    pathsToWrite.map(async (path) => {
      const doc = docsByPath.get(path);
      if (doc === undefined) return;
      await writeDoc(path, toFrontmatterDoc(doc.title, doc.sourceUrl, fetchedAt, doc.body));
    }),
  );

  // Deleting is driven by the disk, not by `diff.gone`, and happens *before*
  // the manifest is written. Both matter: the manifest is the complete
  // statement of what belongs here, so anything else under docs/ is an
  // orphan (including one left by an earlier interrupted run, which `gone`
  // can no longer name); and pruning first means an interruption leaves the
  // old manifest in place, so the next run simply retries rather than
  // forgetting the file forever.
  const orphans = selectOrphanedPaths(
    diff.manifest.map((entry) => entry.path),
    onDisk,
  );
  const pruned = await pruneGoneDocs(DOCS_ROOT, orphans);
  if (pruned.skipped.length > 0) {
    console.error(
      `warning: refused to delete ${String(pruned.skipped.length)} path(s) outside docs/: ${pruned.skipped.join(", ")}`,
    );
  }

  await writeFile(MANIFEST_PATH, `${JSON.stringify(diff.manifest, null, 2)}\n`, "utf8");

  const previousChangelog = await loadPreviousChangelog();
  const changelog = appendEntry(
    previousChangelog,
    { fetchedAt, added: diff.added, updated: diff.updated, gone: diff.gone },
    CHANGELOG_MAX_ENTRIES,
  );
  await writeFile(CHANGELOG_PATH, `${JSON.stringify(changelog, null, 2)}\n`, "utf8");

  console.error();
  console.error(`added:     ${String(diff.added.length)}`);
  console.error(`updated:   ${String(diff.updated.length)}`);
  console.error(`unchanged: ${String(diff.unchanged.length)}`);
  console.error(`gone:      ${String(diff.gone.length)}`);
  if (pruned.deleted.length > 0) {
    console.error(`  deleted from disk: ${pruned.deleted.join(", ")}`);
  }
}

await main();
