/**
 * Query and document tokenisation for the docs index.
 *
 * Pure by design -- the ranker in step 2.4 depends on this being deterministic,
 * because its score assertions are exact. See PLAN.md step 2.2.
 */

/**
 * Function words carry no retrieval signal in a corpus this small. The list is
 * deliberately short: anything that could plausibly be domain vocabulary
 * (`set`, `get`, `use`, `all`, `no`, `not`, `one`) stays out of it.
 */
const STOPWORD_LIST = [
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can",
  "did", "do", "does", "for", "from", "had", "has", "have", "how", "i",
  "if", "in", "into", "is", "it", "its", "of", "on", "or", "our", "that",
  "the", "their", "them", "then", "there", "these", "they", "this", "to",
  "was", "were", "what", "when", "where", "which", "who", "why", "will",
  "with", "would", "you", "your",
] as const;

export const STOPWORDS: ReadonlySet<string> = new Set(STOPWORD_LIST);

/**
 * A token opens on a letter or digit, then may continue through the joiners
 * `-`, `.`, `+`, `#`. Requiring a letter or digit first is what strips leading
 * punctuation: `.mcp.json` starts matching at `m`, and `--help` at `h`.
 *
 * `\p{L}` rather than `a-z` so accented and non-Latin scripts survive instead
 * of being silently deleted.
 */
const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}\-.+#]*/gu;

/** Trailing `-` and `.` are sentence punctuation; trailing `+`/`#` are part of
 * names like `c++` and `c#`, so they stay. */
const TRAILING_PUNCTUATION_RE = /[-.]+$/;

/** A lone ASCII letter is almost always debris -- the `s` left by `server's`,
 * or a list marker. Non-ASCII single characters are kept, since a single CJK
 * character is a real word. */
const LONE_ASCII_LETTER_RE = /^[a-z]$/;

/** Shorter than this and a trailing `s` is more likely part of the word than a
 * plural marker (`js`, `os`, `gas`). */
const PLURAL_MIN_LENGTH = 4;

/** Endings where a trailing `s` is not a plural: `class`, `status`, `analysis`. */
const NOT_A_PLURAL_RE = /(ss|us|is)$/;

/**
 * Deliberately cruder than a real stemmer. It only has to make the singular and
 * plural forms of a word agree with each other -- `responses` and `response`
 * both becoming `response` -- so that a plural query reaches singular prose.
 * Where it guesses wrong it guesses consistently, mapping both the query and
 * the document to the same token, so retrieval still works.
 */
function foldPlural(token: string): string {
  if (token.length >= 5 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (
    token.length >= PLURAL_MIN_LENGTH &&
    token.endsWith("s") &&
    !NOT_A_PLURAL_RE.test(token)
  ) {
    return token.slice(0, -1);
  }
  return token;
}

export function tokenize(text: string): string[] {
  const tokens: string[] = [];

  for (const match of text.toLowerCase().matchAll(TOKEN_RE)) {
    const token = match[0].replace(TRAILING_PUNCTUATION_RE, "");
    if (token === "") continue;
    if (LONE_ASCII_LETTER_RE.test(token)) continue;
    // Checked before folding so `does` is dropped rather than kept as `doe`,
    // and again after, in case folding lands on a function word.
    if (STOPWORDS.has(token)) continue;

    const folded = foldPlural(token);
    if (STOPWORDS.has(folded)) continue;
    tokens.push(folded);
  }

  return tokens;
}
