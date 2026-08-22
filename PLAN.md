# PLAN.md — claude-mcp-server

**Goal:** a local stdio MCP server that indexes Markdown under `docs/` and exposes
`search_docs`, so Claude retrieves its own current instructions on demand instead
of carrying a doc dump in context.

**Ranking:** in-memory BM25 (k1=1.2, b=0.75). No network, no model, no vector store.

---

## Phase 1 — Scaffold  ✅ done

- [x] `package.json` (ESM; scripts: `test`, `test:watch`, `typecheck`, `build`, `dev`)
- [x] `tsconfig.json` (NodeNext, strict) + `tsconfig.build.json`
- [x] Vitest installed + a smoke test proving the runner works
- [x] `src/`, `tests/`, `docs/` created
- [x] `CLAUDE.md`, `PLAN.md`
- [x] `git init` + first commit

**Exit criteria:** `npm test` runs green with zero implementation code.

---

## Phase 2 — `search_docs`  ← current

Each step is one TDD cycle: write the listed tests, watch them fail, implement,
go green, commit. Every module in 2.1–2.5 is a **pure function** — no fs, no server.

### 2.0 — Test fixtures  ✅ done
Fixtures live in two sets, not one, and the split is load-bearing:

- `tests/fixtures/corpus/` — three realistic docs (`mcp/transports.md`,
  `claude-code/settings.md`, `api/messages.md`). This is the ground truth for
  every index and ranking assertion.
- `tests/fixtures/edge-cases/` — five parser-only files: empty, no frontmatter,
  malformed frontmatter, unterminated frontmatter, no headings.

**Why separate:** an empty or malformed file in the ranking corpus would change
`avgdl`, and BM25 normalises every score by `avgdl`. Mixing them would make the
hand-computed scores in 2.4 shift for reasons unrelated to the ranker.

`tests/fixtures/load.ts` reads a set and returns `{ path, raw }[]` sorted by
path. `tests/fixtures.test.ts` guards the fixtures themselves — it pins the
document frequencies 2.3 and 2.4 will assert against (`stdio`=1, `mcp`=2,
`server`=3) so a careless fixture edit fails here rather than in the ranker.

`tests/smoke.test.ts` deleted; it has served its purpose.

### 2.1 — Parser: frontmatter + chunking  ✅ done
`parseDoc(raw, path) -> { path, title, meta, chunks[] }` in `src/parse-doc.ts`.
Pure: no fs, no server. 18 tests in `tests/parse-doc.test.ts`.

**Behaviours pinned by test:**

- Frontmatter is a hand-rolled `key: value` parser. `tags` splits on commas
  into a list; a line with no colon is skipped rather than thrown on.
- **Unterminated frontmatter is treated as body**, not metadata. Swallowing the
  remainder would lose the whole document; indexing it as text keeps it findable.
- Chunks split on headings up to `SPLIT_MAX_LEVEL`. Heading-shaped lines inside
  a fenced block (backtick or tilde) do not split.
- `headingPath` is a stack, so `### Framing` under `## stdio` carries
  `["stdio", "Framing"]`.
- Lead chunks (prose before the first heading) are kept, except when empty.
  Empty *headed* chunks are kept — the heading text is still worth matching.
- Anchors are slugs, disambiguated on collision (`setup`, `setup-2`, `setup-3`).
- Title resolution: frontmatter `title` → first H1 → file stem.
- `startLine` is the 1-based line in the original file, so `get_doc` can cite it.

**Deviation:** PLAN originally said split on `##`/`###`. Implemented as
`SPLIT_MAX_LEVEL = 3`, which also splits on `#` — otherwise a doc whose only
structure is H1s collapses into one chunk. H4+ stays inline, because chunks
small enough to distort `avgdl` would skew every BM25 score in 2.4.

### 2.2 — Tokenizer  ✅ done
`tokenize(text) -> string[]` in `src/tokenize.ts`. 15 tests in
`tests/tokenize.test.ts`. Also exports `STOPWORDS`.

- Lowercases. A token opens on a letter or digit and continues through the
  joiners `-` `.` `+` `#`, so `claude-code`, `4.5`, `c++`, `c#` and `mcp.json`
  survive whole, while leading punctuation is stripped (`--help` → `help`).
- `\p{L}` not `a-z`, so accented and non-Latin scripts are kept rather than
  silently deleted.
- `_` is a separator, so `max_tokens` is reachable as `max` + `token`.
- Lone ASCII letters are dropped (the `s` left behind by `server's`).
- Stopwords are checked before folding, so `does` is dropped rather than
  surviving as `doe`, and again after.

**Plural folding: implemented, on evidence.** 2.2 originally deferred it until
tests showed it helped. Scanning the corpus found nine singular/plural pairs
across three documents (`servers`/`server`, `messages`/`message`,
`requests`/`request`, …), so `"how do I configure MCP servers?"` missed the
document that says `server` throughout. Trailing `s` folds when the token is
4+ characters and does not end `ss`/`us`/`is`; `-ies` folds to `-y`. Cruder
than a stemmer on purpose: it only has to map query and document to the *same*
token, and where it guesses wrong it guesses consistently. After folding, zero
splits remain, and `df` for `stdio`/`mcp`/`server` is still 1/2/3 — so the
ground truth 2.4 asserts against is unchanged.

### 2.3 — Index  ✅ done
`buildIndex(docs) -> Index` in `src/build-index.ts`, plus
`documentFrequency(index, term)`. 12 tests in `tests/build-index.test.ts`.

- **The retrievable unit is the chunk, not the document.** `df` counts chunks
  carrying a term. Doc-level `df` (what `fixtures.test.ts` pins) is a different,
  coarser number — `stdio` is df=1 by document and df=2 by chunk.
- Postings keep `bodyTf` and `headingTf` apart, so 2.4 can weight heading hits
  without a second pass.
- The whole `headingPath` is indexed into each chunk, so `### Framing` under
  `## stdio` still answers a query about stdio.
- `length` = body + heading tokens. `avgdl` is their mean; 0 for an empty
  corpus rather than `NaN`.
- Terms sorted by code point (not `localeCompare`, which varies with host ICU
  data), postings sorted by chunk, so two builds match byte for byte.
- Document title is denormalised onto each chunk so a hit renders without a
  lookup back to the document.

**Real corpus:** 10 chunks, avgdl 17.6 tokens, 126-term vocabulary.

**Resolved at 2.4:** the `stdio` chunk being 42 tokens against an avgdl of 17.6
turned out *not* to be the ranking problem it looked like. See 2.4. `b` stays at
0.75 and code fences stay indexed and counted.

**Amended at 2.4:** `Posting` gained `ancestorTf`, and `headingTf` narrowed to
mean the chunk's *own* heading. Ancestor headings are still indexed, just
tracked separately so the ranker can weight them down.

**Not indexed yet:** frontmatter `tags` and the document `title` are parsed but
never tokenised into the index. Revisit at 2.5 if recall is poor.

### 2.4 — BM25 ranker  ✅ done
`rank(index, queryTokens, opts?) -> ScoredChunk[]` in `src/rank.ts`, plus
`inverseDocumentFrequency` and `BM25_DEFAULTS`. 15 tests in `tests/rank.test.ts`.

- `k1: 1.2`, `b: 0.75`, `headingBoost: 2`, `ancestorBoost: 1`.
- Smoothed idf, `ln(1 + (N - df + 0.5) / (df + 0.5))`. The textbook form goes
  negative once a term appears in more than half the corpus, letting a common
  word *subtract* from a score; this decays toward zero instead.
- Ties break on score, then path, then `startLine` — never insertion order.
- Returns `matched` terms per hit, so 2.5 can centre snippets on them.

**The ranking bug this step found.** With one heading weight for own *and*
inherited headings, the query `stdio` ranked `#framing` (2.13) above `#stdio`
(1.80) — and `### Framing` contains the word nowhere in its own heading or body.
It scored purely by inheritance.

Sweeps separated the two candidate causes:

| lever | result |
| --- | --- |
| `b` from 0.90 → 0.25 | ordering correct at *every* value — length was never the cause |
| `ancestorBoost` 2 → 1.5 | still wrong |
| `ancestorBoost` 1 → 0.5 | correct |

So the fix was structural, not a tuning nudge: separate `ancestorTf` in the
index and weight it at body level. Margin at the default is 1.795 vs 1.577.
Note 1.0 is the *highest* safe value — worth re-checking against real docs
at 2.7.

**Known recall gap, no fix attempted.** The query "what happens if I log to
stdout" returns nothing, even though the stdio section covers exactly that. The
prose says "standard output" and "logging"; the query says "stdout" and "log".
Pure lexical matching cannot bridge either gap. Deliberately *not* worked around
by rewording the fixture — that would hide the limitation rather than record it.
This is the concrete case to weigh at 2.7 and against the Phase 3 `Ranker`
swap.

### 2.5 — `search()` facade  ✅ done
`search(index, query, opts?) -> SearchHit[]` in `src/search.ts`, plus
`SEARCH_DEFAULTS` (`limit: 5`, `maxChars: 320`). 12 tests in
`tests/search.test.ts`.

- Takes a raw query string and tokenises internally; `rank` still takes tokens.
- A hit carries `path`, `anchor`, `title`, `headingPath`, `startLine`, `score`
  and `snippet` — enough to render and cite without a second lookup.
- Snippet text is whitespace-flattened *first*, so offsets and the character
  budget agree with what is actually returned.
- The window is the one covering the most query terms, with a quarter-width
  lead so the first match is not flush against the edge. Ellipses come out of
  the budget, never on top of it.
- A chunk can rank on its heading alone, leaving no query term in the body.
  That falls back to the opening of the body rather than returning nothing.

**Tokenizer change:** `tokenizePositions` added and `tokenize` redefined in
terms of it. Snippet centring needs offsets, and deriving both from one code
path means highlighting can never drift from matching.

**Bug found and fixed while building.** A window anchored at the far end of a
chunk was clamped to `textLength - maxChars`, then charged for its leading
ellipsis afterwards — leaving it one character short of the end, at which point
the word-boundary snap dropped the very term the window was centred on. The
clamp now reserves the ellipsis up front.

**Cap verified by fuzzing, not just by example:** 3400 snippets across five
queries at every width from 1 to 200 characters. Worst overshoot 0.

### 2.6 — MCP server wiring
First step that touches I/O. `src/index.ts`: stdio transport, tool registration.

- `search_docs(query, limit?)` → ranked hits with snippets
- `get_doc(path, anchor?)` → one full chunk, for when a snippet isn't enough

Loader walks `docs/`, reads files, feeds the 2.1–2.5 pipeline.

Tests: tool schemas validate · handler returns MCP-shaped content · unknown
`path` in `get_doc` returns an error result rather than throwing · **nothing
reaches stdout except protocol frames**.

### 2.6.5 — Fetch the corpus
New step, added once `docs/` was settled as a cache (see Decisions below).

- `docs.manifest.json` — committed. One entry per document: source URL, local
  path, content hash, fetched-at date.
- A fetch script that pulls each entry, writes it under `docs/`, updates the
  manifest, and **reports what changed** — added, updated, unchanged, gone.
- Re-runnable and idempotent. Running it twice in a row changes nothing.

**Unverified, and worth checking before designing this:** how Anthropic
publishes machine-readable docs. Whether there is an `llms.txt` / `llms-full.txt`
index, per-page Markdown, or only HTML decides whether this is ~40 lines or a
genuinely fiddly component. Do not guess — go and look.

### 2.7 — Run it for real
- `npm run dev` smoke test against a hand-typed query
- Register in `.mcp.json`, restart Claude Code, confirm the tool appears
- Fetch the real corpus with 2.6.5 and eyeball the top hits
- **Re-check `ancestorBoost`.** 1.0 is the highest value that ranks the 2.4
  fixture correctly. Real documents have deeper heading trees, so confirm it
  still holds rather than assuming.
- **Re-check the lexical recall gap** from 2.4 ("stdout" vs "standard output")
  against real prose, where the vocabulary mismatch may be better or far worse.

**Exit criteria:** I ask you a question about MCP and you answer by calling
`search_docs` — not from memory, and not from a context dump.

---

## Phase 3 — backlog (unscheduled)

- Reindex on file change (`fs.watch`) rather than on boot
- Cache index to disk; skip reparse when mtimes are unchanged
- `list_docs` tool for corpus discovery
- Extract a `Ranker` interface if lexical recall proves too brittle — 2.4 found
  a concrete case where it does
- **A digest of what changed on the last sync.** `search_docs` is pull-based: it
  only helps when I think to query it. "Keep me current" implies something
  push-shaped too. Different feature, same goal.

---

## Decisions

### `docs/` is a cache, not a work product  — settled
The corpus is a true mirror of Anthropic's published documentation, kept
current. It is therefore **gitignored**, with `docs/.gitkeep` retained so the
directory survives a clone. Committed instead: `docs.manifest.json` and the
fetch script, so anyone can rebuild the exact corpus.

**Why not commit it:** committing a regenerable mirror is the `node_modules`
mistake. It also buries staleness — the whole premise of this project is that
stale instructions are the problem, and a committed snapshot moves the staleness
from the context window into git, where it is *less* visible rather than more.

**Consequence — `docs/` is read-only by convention.** A refresh overwrites it,
so hand-edits get destroyed silently. Anything written by hand belongs in
`CLAUDE.md`, or a committed `notes/` directory if it grows.

**Consequence — freshness is a feature, not backlog.** The manifest carries a
hash and a fetched-at date per file so "what changed since last sync" is
answerable, and a result can say how old its source is.

### Test fixtures stay separate from `docs/`  — settled at 2.0
`tests/fixtures/` is committed and pinned; no test reads `docs/`. This decision
is what makes the corpus disposable — test reproducibility does not depend on it.

## Open questions

1. Should frontmatter `tags` and document titles be indexed? Both are parsed
   today, neither is tokenised into the index, so a document whose title is the
   only place a term appears cannot be found by it.
2. Does a hand-written `notes/` directory get created now, or wait until there
   is something to put in it?
