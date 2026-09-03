/**
 * Fetches a URL while re-validating every hop of an HTTP redirect chain
 * against the same safety gate the initial URL had to pass. Plain `fetch`
 * follows redirects transparently, so validating only the starting URL (as
 * `fetchTextSafely` used to) lets a server on the allowlist redirect
 * anywhere -- including off the allowlist -- with `assertSafeFetchUrl` never
 * seeing the real destination. See PLAN.md 2.6.5 and CLAUDE.md's fetch
 * safety rule.
 *
 * Pure orchestration over an injectable `fetchImpl`/`validate` pair so the
 * redirect-following behavior is testable against a local HTTP server
 * without touching the real network or the production host allowlist.
 */

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/** Above this many hops, treat the chain as a runaway/hostile redirect loop
 * rather than following it indefinitely. */
const DEFAULT_MAX_REDIRECTS = 5;

export interface SafeFetchOptions {
  /** Called on the initial URL and again on every redirect target's resolved
   * absolute URL. Throw to reject a hop. */
  validate: (url: string) => void;
  /** Defaults to the global `fetch`. Overridden in tests. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Bounds how many redirect hops are followed before giving up. */
  maxRedirects?: number;
}

/**
 * Resolves to the final, non-redirect `Response`. Every URL in the chain --
 * the starting one and each `Location` target -- is passed to `validate`
 * before it is fetched, so a redirect to a disallowed host throws instead of
 * being followed.
 */
export async function fetchWithSafeRedirects(
  url: string,
  { validate, fetchImpl = fetch, signal, maxRedirects = DEFAULT_MAX_REDIRECTS }: SafeFetchOptions,
): Promise<Response> {
  let currentUrl = url;

  for (let hop = 0; ; hop++) {
    validate(currentUrl);
    const response = await fetchImpl(currentUrl, { redirect: "manual", signal });

    if (!REDIRECT_STATUSES.has(response.status)) return response;

    if (hop >= maxRedirects) {
      throw new Error(`Exceeded ${String(maxRedirects)} redirects fetching ${url}`);
    }

    const location = response.headers.get("location");
    if (location === null) {
      throw new Error(`Redirect (${String(response.status)}) from ${currentUrl} had no Location header`);
    }

    currentUrl = new URL(location, currentUrl).toString();
  }
}
