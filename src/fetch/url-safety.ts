/**
 * Security gates for the fetcher: an explicit host allowlist and a
 * path-traversal guard. Pure -- string and URL parsing only, no fs, no
 * network. See PLAN.md 2.6.5 and the standing rule in CLAUDE.md.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";

const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "code.claude.com",
  "platform.claude.com",
  "support.claude.com",
]);

/** Throws unless `url` is HTTPS and its exact hostname is on the allowlist.
 * Exact match, not `.includes()` or `.endsWith()` -- either would let
 * `code.claude.com.evil.com` or `not-code.claude.com` slip through. */
export function assertSafeFetchUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a valid URL: ${url}`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`Refusing non-HTTPS URL: ${url}`);
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`Host not on the fetch allowlist: ${parsed.hostname}`);
  }
}

/** True only if `candidate`, resolved against `docsRoot`, stays inside it and
 * names a file rather than the root itself. Guards against a manifest path
 * or derived filename escaping `docs/` via `..` or an absolute path. */
export function isPathInsideDocs(docsRoot: string, candidate: string): boolean {
  if (candidate.trim() === "" || candidate === ".") return false;

  const root = resolve(docsRoot);
  const target = resolve(docsRoot, candidate);
  const rel = relative(root, target);

  // `relative()` normally signals escape with a leading "..", but on Windows
  // a target on a different drive comes back as an unrelated absolute path
  // instead -- `isAbsolute` catches that case too.
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
