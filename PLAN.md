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

### 2.6 — MCP server wiring  ✅ done
Split into two modules, per the pure-core / I-O-at-the-edges convention:

- `src/load-docs.ts` — `loadDocs(rootDir) -> ParsedDoc[]`. The one impure step
  in the pipeline. A missing directory returns `[]` rather than throwing,
  since `docs/` is gitignored (see Decisions) and only populated by the 2.6.5
  fetch step — a fresh clone has to start regardless.
- `src/server.ts` — `createServer(index) -> McpServer`, registering
  `search_docs(query, limit?)` and `get_doc(path, anchor?)`. Takes an
  already-built `Index`, so it needs no transport or filesystem to test.
- `src/index.ts` — the entry point. Loads `docs/`, builds the index, wires
  `createServer` to `StdioServerTransport`. No unit tests of its own by
  design; it's the I/O edge everything else was built to keep clean of.

26 tests across `tests/load-docs.test.ts` and `tests/server.test.ts`.

**Tested against the real protocol, not handlers in isolation.** Rather than
calling the registered tool callbacks directly, tests wire a real `Client` to
the real `McpServer` over `InMemoryTransport`, so schema validation, request
routing, and result-shaping all run for real.

**"Nothing reaches stdout except protocol frames" is tested literally, not by
convention.** A real `StdioServerTransport` is wired to a `PassThrough`
standing in for stdout; every line written is asserted to be valid JSON. A
stray `console.log` anywhere in the handler path would show up here as a line
`JSON.parse` rejects.

**One test expectation was wrong, not the code.** I assumed a malformed
argument (`limit: "not-a-number"`) would reject the client's request — the
behaviour of other MCP SDKs I'd seen before. Reading this SDK's source
(`server/mcp.js`) showed it deliberately catches the validation `McpError` and
returns a normal `CallToolResult` with `isError: true` instead. Fixed the test
to assert the actual contract, and to assert what still matters: the
malformed value never reaches `search()`.

**Verified against a real subprocess, not just in-process tests.** Spawned
`src/index.ts` as an actual child process via `StdioClientTransport`, listed
tools and called one over real OS pipes, against the actual (currently empty)
`docs/` directory. Confirms the empty-corpus path doesn't crash and
diagnostics land on stderr, not just that the pieces typecheck together.

**Caught for 2.7, not yet a problem:** `npm run dev` prints npm's own banner
(`> claude-mcp-server@0.1.0 dev`) to stdout *before* the server starts. Fine
for a human running it by hand; fatal if `.mcp.json` ever registers the
command as `npm run dev` instead of a raw `tsx src/index.ts` / `node
dist/index.js` — that banner would corrupt the first bytes of the protocol
stream. Register the raw command at 2.7, not the npm script.

### 2.6.5 — Fetch the corpus  ✅ done
Scope was reverse-engineered from an unstructured statement of the user's
goals for this whole project (become a Claude Code power user; know the ins
and outs of Claude; think and problem-solve better; stay on the cutting edge;
security and engineering fundamentals required; scaffold the learning). Full
reasoning trace lives in the approved plan at the time
(`toasty-crunching-treasure.md`); the load-bearing conclusions:

**What gets fetched, and why:**

| Source | Scope | Real count |
| --- | --- | --- |
| `code.claude.com/docs` | All of it — named priority #1 | 191 pages |
| `platform.claude.com/docs` | Curated: thinking, context/caching, prompt engineering, tool use, agent skills, MCP connector/tunnels — **not** the ~550-page API/billing/admin reference | 58 pages |
| `support.claude.com` (Help Center) | Cowork, Desktop, Chrome, Mobile collections only — not billing, SSO, Bedrock, Gov | 34 articles |

**283 documents total**, indexing to 4980 chunks, avgdl 172.4 tokens.

**Two assumptions from the plan turned out wrong, caught by verifying against
real bytes rather than trusting the plan's own prediction:**

- **Platform and Code docs do NOT share one `llms-full.txt` grammar**, despite
  both being Mintlify sites. Code's is `# Title` immediately followed by
  `Source: <url>`. Platform's is a fenced `---\ntitle:...\nurl:...\n---` block,
  and critically the `## heading` before it is *not* a reliable title source —
  the real file often has an unrelated in-body subheading (e.g. "## Next
  steps" left over from the previous page) sitting closer to the block than
  any actual page title. Two separate parsers:
  `src/fetch/parse-llms-full.ts` and `src/fetch/parse-platform-llms-full.ts`.
  Both verified against the real files (8MB and 40MB) before being trusted —
  191/191 and 612/612 records recovered, zero suspect records, zero
  duplicates, the one extreme outlier (a 573KB body) confirmed by eye to be
  a legitimately huge page (`/changelog`) and not a swallowed neighbor.
- **"Agent SDK" isn't part of the curated platform slice — it lives entirely
  under `code.claude.com/docs/en/agent-sdk/`**, already covered by "fetch all
  of Code." The plan's source table implied it belonged to the platform
  curation step; it doesn't need one.

**A near-miss the tests now guard against:** a first-pass keyword filter for
the platform slice (matching "mcp", "skills", etc. anywhere in the URL) pulled
in raw REST CRUD reference endpoints — `/api/skills/create`,
`/api/admin/mcp_tunnels/reveal_token` — purely on keyword overlap, exactly the
API-reference noise the scope decision was supposed to exclude.
`src/fetch/platform-scope.ts` excludes `/docs/en/api/` unconditionally, tested
against that specific failure case by name.

**No collections API exists on the Help Center** (confirmed: the standard
Zendesk endpoint 404s; the site is Next.js-rendered). Classification is by
keyword in the article slug instead
(`src/fetch/help-center-scope.ts`), built and tested against the real ~350
article slugs pulled from the live homepage — including the enterprise/admin/
deploy-flavored articles that sit inside otherwise-included collections
(`deploy-claude-desktop-for-macos`, `claude-in-chrome-admin-controls`) and
have to be excluded individually. Approximate by design, not exhaustive.

**Module layout**, pure-core / IO-at-the-edges as at 2.6:
`src/fetch/parse-llms-full.ts`, `parse-platform-llms-full.ts`,
`platform-scope.ts`, `help-center-scope.ts`, `manifest.ts`, `url-safety.ts` —
41 tests across `tests/fetch/*`, each verified against real production data in
addition to its own test suite. `scripts/fetch-docs.ts` is the thin,
untested-by-design I/O entry point (network + fs), same rationale as
`src/index.ts` at 2.6.

**Security**, per the plan and the new standing line in `CLAUDE.md`:
hostname allowlist (`assertSafeFetchUrl`), HTTPS-only, a streamed
200MB response cap with a 30s timeout, and a path-traversal guard
(`isPathInsideDocs`) on every write under `docs/`.

**Known simplification, not yet built:** the Help Center's `sitemap.xml`
exposes a `lastmod` per article, which could skip re-fetching a page whose
source hasn't changed. Not implemented — every run re-fetches every article
and compares content hashes instead, which is correct but not maximally
efficient. `ManifestEntry.sourceLastMod` exists as a field for this; nothing
populates it yet.

**Verified for real, not just typechecked:** ran the actual fetch script live
twice — first run: 283 added, 0 unchanged; second run: 0 added, 283
unchanged, confirming idempotency. Then pointed the existing, unmodified 2.1–
2.5 pipeline at the real `docs/` output and hand-ran six queries. Both open
questions 2.7 was going to check got a preliminary answer:

- **`ancestorBoost: 1` holds up** on the real, much deeper heading trees
  (spot-checked, not exhaustively swept — formal re-check still belongs at 2.7).
- **The "stdout" vs "standard output" recall gap from 2.4 did not reproduce.**
  Real docs about hooks and plugins use the literal words "stdout" and "log"
  throughout, so the query returns strong, correctly-ranked hits. This says
  the *specific* gap was a fixture-vocabulary artifact, not that lexical
  matching's ceiling is fine in general — 2.7 should still probe other
  paraphrase gaps before calling the question closed.

### 2.7 — Run it for real  ✅ done (except the restart, see below)

**`.mcp.json` registered** at the project root, project scope, committed:

```json
{
  "mcpServers": {
    "claude-docs": {
      "type": "stdio",
      "command": "node",
      "args": ["--import", "tsx", "${CLAUDE_PROJECT_DIR:-.}/src/index.ts"]
    }
  }
}
```

Schema confirmed against the real `docs/claude-code/mcp.md` fetched at 2.6.5
— including the `${CLAUDE_PROJECT_DIR:-.}` default, which the doc calls out
by name as required for project-scoped entries. Uses the raw `node --import
tsx` invocation, not `npm run dev` — the banner problem flagged at 2.6 is a
real hazard for exactly this file.

**Smoke test:** ran the literal `.mcp.json` command as a subprocess (not
`npm run dev`, for the same banner reason) and called `search_docs` with a
hand-typed-style query, "how do I use skills in Claude Code." Real, correctly
ranked results; stderr carried only the one-line index summary. One
observation from the result, not a bug: a few lower-ranked hits were "Next
steps" nav sections (MDX `<Card>` link lists), which score well because they
pack matched terms densely into a short chunk — legitimate BM25 behaviour,
but a real content-quality artifact of indexing raw MDX boilerplate.
Candidate Phase 3 item, not fixed here.

**`ancestorBoost` swept exhaustively, not spot-checked.** Every non-lead
heading in the real corpus (3995 of them) used as its own query, across eight
candidate values:

| `ancestorBoost` | violations / 3995 |
| --- | --- |
| 0.25 – 0.75 | 0 |
| **1.00 (shipped)** | **1** |
| 1.25 | 1 |
| 1.50 | 6 |
| 1.75 | 14 |
| 2.00 | 23 |

Confirms the 2.4 finding at scale: the violation rate climbs clearly and
monotonically above 1.0, so 1.0 is the right default, not a lucky fit to a
3-document fixture. The one real violation at 1.0 was inspected rather than
waved away: "Get started in the CLI" (own body: a numbered walkthrough that
never says "CLI") loses to its child "Manage site permissions" (a short
section that inherits "get"/"started"/"cli" purely from the parent heading).
Milder than the 2.4 pattern — the "losing" chunk's own content is only
weakly on-topic to begin with, not an exact-title match losing to something
irrelevant — and at a 15% score margin. Left as-is.

**Lexical recall gap probed with real paraphrases, not the one 2.4 case.**
Seven natural, casually-worded queries a user might actually type, deliberately
avoiding the docs' own vocabulary:

| Query | Result |
| --- | --- |
| "run claude without asking for permission every time" | hit — top 3 all on point |
| "undo a change claude made" | hit — top result is exactly right |
| "have multiple claudes work on the same task" | reasonable — Cowork + Agent Teams surfaced |
| "make claude remember things between sessions" | partial — related but not the best doc |
| "give claude a shortcut command" | partial — one good hit, two tangential |
| "how do I stop claude from editing files" | **miss** — keyboard shortcuts and cache docs, nothing about permissions |
| "claude keeps forgetting what we talked about" | **miss** — informal phrasing shares no vocabulary with the docs; results are noise |

**Conclusion:** the specific 2.4 case ("stdout") was a fixture artifact, as
already found — but the general concern behind it is real. About 2 of 7
casually-phrased real queries produced no useful hit, specifically when the
phrasing is informal or emotional rather than naming a technical concept.
This is the concrete evidence behind the Phase 3 `Ranker`-interface item —
not urgent, but no longer hypothetical.

**Not done — cannot be done from inside this session.** MCP servers load at
Claude Code session start. Registering `.mcp.json` doesn't make `search_docs`
available to *this* running session; it takes effect on the next restart or
new session. So the literal exit criteria below is unverified until then —
next session, ask a real question and check whether I reach for `search_docs`
instead of memory.

**Exit criteria:** I ask you a question about MCP and you answer by calling
`search_docs` — not from memory, and not from a context dump.

---

## Phase 3 — backlog (unscheduled)

- Reindex on file change (`fs.watch`) rather than on boot
- Cache index to disk; skip reparse when mtimes are unchanged
- `list_docs` tool for corpus discovery
- Extract a `Ranker` interface if lexical recall proves too brittle — 2.4 found
  a concrete case where it does, and 2.7 found it's not just that one case:
  ~2 of 7 real casually-phrased queries against the real corpus missed
  entirely, specifically informal/emotional phrasing that shares no
  vocabulary with doc prose
- Strip MDX component boilerplate (`<Card>`/`<Steps>` nav link lists, "Next
  steps" sections) before indexing. 2.7 found these score artificially well
  under BM25 — a short chunk densely packed with matched terms — despite
  carrying little real content. Not urgent; found once, not systematically
  measured.
- **A digest of what changed on the last sync.** `search_docs` is pull-based: it
  only helps when I think to query it. "Keep me current" implies something
  push-shaped too. Different feature, same goal. Traced directly to the same
  brain dump as the corpus-scope decision below: "always be on the cutting
  edge of Claude and its features."
- **A topic-organized browse/`list_docs` tool, fundamentals vs. advanced.**
  The concrete form "teach me... scaffold my knowledge of how Claude works"
  takes beyond what 2.6.5 could cheaply do. 2.6.5 gave the corpus a
  topic-organized directory layout for near-zero cost; an actual browsing/
  learning-path tool is a real feature, deliberately not built at 2.6.5 to
  avoid scope creep into a curriculum engine.
- Populate `ManifestEntry.sourceLastMod` from the Help Center's
  `sitemap.xml` and skip re-fetching an article whose `lastmod` hasn't moved.
  Correctness doesn't depend on this (content-hash comparison already works);
  it would only save unnecessary fetches.

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

### Corpus scope reverse-engineered from stated goals — settled at 2.6.5
The user gave an unstructured statement of what this whole project is for,
and asked for it to be translated into the fetcher's scope directly rather
than handed back as a menu. The scope table and reasoning live at 2.6.5
above. Recorded here so a future re-read of this file explains *why* Cowork
is in and the API/billing reference is out, without re-deriving it from a
chat transcript:

- Claude Code named explicitly and first → fetch all of it, not a slice.
- "Ins and outs of Claude... cutting edge of Claude and its features" → scope
  is broader than Code alone; Cowork, Desktop, Chrome are in.
- "Think better, problem solve better, conduct quality research" → justifies
  the platform curation being the *prompting/reasoning* layer specifically
  (thinking, context management, tool use), not API mechanics.
- Not stated: "integrate Claude into a paid product" → justifies excluding
  the ~550-page API/billing/enterprise-admin reference. Different job.
- "This project needs to be secure" → the concrete allowlist/HTTPS/size-cap/
  path-safety rules at 2.6.5, and the new standing line in `CLAUDE.md`.

## Open questions

1. Should frontmatter `tags` and document titles be indexed? Both are parsed
   today, neither is tokenised into the index, so a document whose title is the
   only place a term appears cannot be found by it.
2. Does a hand-written `notes/` directory get created now, or wait until there
   is something to put in it?
