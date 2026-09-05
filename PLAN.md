# PLAN.md — claude-mcp-server

**Goal:** a local stdio MCP server that indexes Markdown under `docs/` and exposes
`search_docs`, so Claude retrieves its own current instructions on demand instead
of carrying a doc dump in context.

**Ranking:** in-memory BM25 (k1=1.2, b=0.75). No network, no model, no vector store.

**Status: v1.0, closed.** Phases 1–4 complete; see Phase 4 for what "closed"
means and what would reopen it.

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

## Phase 2 — `search_docs`  ✅ done

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

**Resolved at 4.1.** Recall *was* poor, and measurably so: 216 of 283 real
docs have no H1, so their title text was unreachable by any query. `Posting`
gained `titleTf` and the ranker a swept `titleBoost`. `tags` stays unindexed
— zero real documents use the field.

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

### 2.7 — Run it for real  ✅ done, confirmed end to end

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

**Checked in a later session — not just "unverified," diagnosed exactly.**
`search_docs`/`get_doc` did not appear in the next session's tool list. Rather
than assume the restart alone was insufficient, ran `claude mcp list`, which
reported the precise mechanism: `claude-docs: ... — ⏸ Pending approval (run
'claude' to approve)`. This is the workspace-trust gate `docs/claude-code/mcp.md`
itself describes — a project-scoped server from a committed `.mcp.json` needs
one interactive approval before Claude Code will load its tools, exactly so
that cloning a repo can't silently run arbitrary commands. Not something an
agent session should self-approve; requires the user to run `claude`
interactively in this project and accept the prompt once.

**Confirmed working end to end, after approval, in a fresh session.**
`claude mcp list` → `claude-docs ... ✔ Connected`; that session's own tool
listing showed `search_docs`/`get_doc` loaded with full schemas; an explicit
call, `search_docs("how do skills work")`, returned five real, correctly
shaped results from the actual 283-document corpus — path, anchor, ranked
snippet, e.g. `platform/agents-and-tools/agent-skills/overview.md#how-skills-work`.
The full mechanism — registration, workspace-trust approval, connection, tool
call, real ranked output — is proven.

**Downstream synthesis checked for faithfulness, not just presence.** Asked
to summarize "how skills work" from those five snippets, that session
produced a cited, per-claim summary. Every specific quote and example was
verified word-for-word against the real fetched files afterward — "organized
like an onboarding guide you'd create," the AWS/Microsoft Foundry inheritance
line, the `/audit` → security/performance/style subagent example, the
`deploy.md`/`SKILL.md` equivalence, the Haiku/Sonnet/Opus framing — all exact,
zero fabrication, correctly attributed by path#anchor. It also flagged
unprompted that a 5-snippet synthesis is narrower than a full-document
answer and offered `get_doc` to fill gaps — exactly the division of labor
`search_docs`/`get_doc` were split for. The project doesn't just return
results; what gets built on top of them holds up.

**The routing gap, resolved with a before/after comparison, not just patched
and hoped.** Two earlier attempts, given the natural question "how do skills
work" with no tool named, reached for other tools first — a research agent,
then a raw filesystem glob over `docs/` (precisely the "don't dump the
corpus into context" anti-pattern `CLAUDE.md` warns against) — before
`search_docs` was ever tried.

**Fix:** an explicit routing rule added to `CLAUDE.md`'s Context discipline
section — call `search_docs` first for any question about Claude, Claude
Code, Cowork, or MCP, before a research agent or `Glob`/`Grep`, with the
confirmed failure mode named as the reason.

**After, in a fresh session:** asked the natural question "How does the
Claude Code agentic loop work?" — no tool named — and it called `search_docs`
immediately, unprompted. It then showed real judgment beyond just calling the
tool once: recognized the top hit as the right section and pulled it whole
with `get_doc`, then ran a *second*, differently-worded `search_docs` call
to fill in supporting detail on "models" and "tools" referenced inside that
section, rather than either stopping short or dumping everything. Final
synthesis checked word-for-word against the real file: accurate, including a
genuine quirk in the source itself (a duplicated image `alt` line, likely a
light/dark asset pair) faithfully preserved by `get_doc` rather than
silently smoothed over.

One data point after the fix isn't proof the routing problem can never
recur, but it's exactly the before/after comparison the fix was aimed at
producing, and it landed. Downstream behavior — the two-call research
pattern, the faithful synthesis — is also now demonstrated on a genuinely
unprompted question, not just an explicit tool invocation.

**Exit criteria:** I ask you a question about MCP and you answer by calling
`search_docs` — not from memory, and not from a context dump.

---

## Step 2.8 — `recent_changes`: a digest of what changed on the last sync

A full `/code-review high --fix` pass (initial scaffold → HEAD, since this
project has never used PR branches) landed 8 fixes and deliberately deferred
2: `src/tokenize.ts`'s cookie/movie plural folding (needs a wordlist to
disambiguate `-ie`-ending nouns from the regular consonant+y→ies pattern —
not a narrow patch) and `src/rank.ts`'s `ancestorTf` depth-stacking bug
(a real fix needs the same full-corpus resweep rigor as the original
`ancestorBoost` tuning at 2.4/2.7 — well outside code-review scope). Both
stay deferred; nothing below changes that.

With Phase 2 fully verified end to end, the question was what to build next:
7 Phase 3 backlog items plus those 2 deferred findings, weighed against each
other on effort, dependencies, and fit with the two stated project goals
("become a Claude Code power user," "stay on the cutting edge") — not just
picking whatever was listed first.

| Item | Effort | Serves the goals? |
|---|---|---|
| **Sync digest ("what changed")** | **Low–medium** — `diffManifest` already computes added/updated/gone on every fetch; it was being discarded after a stderr print. | **Directly** — the one *push*-shaped item; `search_docs` only helps when you think to ask. |
| Cookie/movie plural folding | Low but narrow (needs a disambiguating wordlist) | Marginal — one lexical edge case, doesn't move real-query recall |
| ancestorTf depth decay | **High** — needs the 2.4/2.7-grade full-corpus resweep, not a quick patch | Real but narrow (rare depth-3+ heading collisions) |
| `Ranker` interface extraction | Medium to extract, but fixes nothing alone — the actual 2/7 casual-query recall gap needs a second ranker (semantic/embedding) built behind it, which is a much bigger, unscoped lift | High potential, wrong time — building the seam before there's a second implementation to justify it is exactly the "design for a hypothetical future" CLAUDE.md warns against |
| Strip MDX boilerplate | Medium | Minor; PLAN.md itself notes this was found once, not systematically measured |
| `list_docs` tool | Medium | Moderate — overlaps some with `search_docs`'s existing `path`/`headingPath` |
| Topic-organized browse tool | **High**, and flagged in its own backlog entry as scope-creep risk | High value, deliberately not now |
| Reindex-on-change / cache index to disk | Low–medium each | None — dev/perf convenience, not user-facing |
| Populate `sourceLastMod` from sitemap | Low | None — stated as optimization-only; correctness doesn't depend on it |

**Decision:** build the sync digest. Best effort-to-goal ratio on the board —
the hard part (diffing two manifests) was already written, tested, and
running on every fetch. Zero dependency on any other item, so it doesn't
foreclose picking `list_docs` or the browse tool next.

**Design**, following the pure-core / IO-at-the-edges split used throughout:
- `src/fetch/changelog.ts` (pure): `ChangelogEntry` (a trimmed `ManifestDiff`
  — no `unchanged`, no `manifest`), `appendEntry` (caps history at 20
  entries), `summarizeChanges` (formats the most recent N, newest first,
  dropping no-op fetches).
- `scripts/fetch-docs.ts`: after `diffManifest` runs, appends an entry and
  writes `docs.changelog.json` next to `docs.manifest.json` — same
  read-ENOENT-as-empty, write-plain-JSON pattern already used for the
  manifest. Committed for the same reason the manifest is: metadata *about*
  the gitignored `docs/`, not the corpus itself.
- `src/server.ts`: new `recent_changes` tool, no required input (optional
  `limit`, default 5, mirroring `search_docs`'s own `limit`). `createServer`
  takes `changelog` as a second, defaulted parameter — same "handed data, not
  I/O" contract as `index`.
- `src/index.ts`: reads `docs.changelog.json` next to loading the corpus,
  passes it into `createServer`.

**Verification:** TDD throughout (`tests/fetch/changelog.test.ts`,
extended `tests/server.test.ts`), 161/161 green, clean typecheck. Then live:
ran the real fetch script twice in a row — first run produced a real entry
(43 pages updated from minor content drift since the last fetch, 0 added,
0 gone); second run correctly recorded an all-unchanged, no-op entry.
Started the real server over stdio with a real MCP `Client` and called
`recent_changes` directly: it returned the first run's digest, correctly
omitted the second run's no-op entry, and `search_docs`/`get_doc` continued
working unaffected.

---

## Step 2.9 — `list_docs`: corpus discovery

Same weighing exercise as 2.8, against what was left of the Phase 3 backlog
(reindex-on-file-change, disk-cached index, `list_docs`, the `Ranker`
interface / recall gap, MDX-boilerplate stripping, the topic-organized browse
tool, `sourceLastMod`) plus the same two still-deferred code-review findings.

One finding changed the board before the weighing even started: MDX-boilerplate
stripping was checked against the *current* real corpus first, not assumed
still valid from the 2.7 note that motivated it. Grepping all 283 docs for
`<Card>`, `<Steps>`, any `<CapitalizedTag>`, and a literal "Next steps"
heading returns **zero matches**. Whatever produced that 2.7 observation isn't
present now — most likely the `.md`/`llms-full.txt` exports never carried raw
MDX tags to begin with. Dropped from the backlog rather than carried forward
on faith; the code-review discipline of confirming a bug is real before
building a fix applies just as much to backlog grooming.

**Decision:** build `list_docs`. Every `IndexedChunk` already carries `path`
and `title` (`src/build-index.ts`); the corpus already has a topic-organized
directory layout (`claude-code/`, `platform/`, `cowork/`, `chrome/`,
`desktop/`, `mobile/`, confirmed on disk) that had never been exposed to a
client. Zero dependency on anything else on the list, and it's the
non-scope-creep subset of the bigger browse-tool idea — orientation by real
directory structure, not a curriculum engine with fundamentals/advanced
tagging. Everything else on the list is unchanged from 2.8's reasoning
(`Ranker` interface still has no second ranker to justify it; the browse tool
still risks the scope creep its own backlog entry warns about; the two perf
items and `sourceLastMod` remain non-user-facing; both deferred code-review
findings stand on the same reasoning as before).

**Design:** `src/list-docs.ts` (pure) — `listSections(index)` returns one
`{ section, count }` per top-level path segment present in the corpus;
`listDocuments(index, section)` returns that section's `{ path, title }`
pairs, deduped from `index.chunks` (chunks from one document are contiguous
and share a denormalised title). A new `list_docs` MCP tool in `src/server.ts`
takes an optional `section`: omitted, it returns the section summary;
given, it returns that section's documents, or a plain "no documents in
section" message for an unrecognised one — mirroring `search_docs`'s
zero-hits convention rather than erroring.

**Verification:** TDD (`tests/list-docs.test.ts`, extended
`tests/server.test.ts`), 172/172 green, clean typecheck. Live: called
`list_docs` with no argument against the real server — the six section
counts (chrome 4, claude-code 191, cowork 11, desktop 6, mobile 13,
platform 58) sum to exactly 283, the real document count; called it with
`section: "cowork"` and the 11 returned paths matched `ls docs/cowork`
exactly; called it with a made-up section name and got the friendly
zero-results message, not an error.

---

## Step 2.10 — the cookie/movie plural-folding finding, resolved

Re-checked the remaining Phase 3 backlog (reindex-on-file-change,
disk-cached index, `sourceLastMod`, the fundamentals-vs-advanced browse tool)
plus the two still-deferred code-review findings, same discipline as 2.9:
verify each premise against real, current state before weighing it. Nothing
on the backlog proper moved — the two perf items are still non-user-facing,
`sourceLastMod` is confirmed feasible (`support.claude.com/sitemap.xml`
verified live, has real `<lastmod>` per article) but still correctness-
neutral by its own note, and the browse tool is still its own flagged
scope-creep risk.

What changed the board was re-examining the cookie/movie deferral itself
instead of the backlog. It was deferred at the code review because "a robust
fix needs a wordlist... surface form alone can't disambiguate" the two
`-ies` patterns — true in general, but nobody had measured how big the
problem actually is *in this corpus*. Grepped every real `-ies`-ending word
across all 283 docs (`grep -rhoE "[a-zA-Z]+ies" docs | sort | uniq -c`) and
checked each distinct word against its actual quoted context. Result: 5 real
words, not an open dictionary problem —

- `cookies` → singular `cookie` (Chrome cookie-clearing instructions)
- `calories` → singular `calorie` (Android health-data docs)
- `ties` → verb `tie` ("a gateway... ties the client configuration")
- `dies` → verb `die` ("a turn dies on an unrecoverable error")
- `series` → invariant noun — singular and plural are both `series`, not a
  disambiguation case at all, just a word the existing rule mis-transforms

A false-positive scare along the way — "easies"/"earlies"/"heavies" from the
first, unanchored grep — turned out to be substring artifacts of
"easiest"/"earliest"/"heaviest", confirmed away with a `\b`-anchored re-check
before trusting the word list. Same "verify against real bytes" standard as
every other fix in this project.

**Fix:** `src/tokenize.ts` — a 5-entry `IES_EXCEPTIONS` map, checked in
`foldPlural` before the general `-ies → -y` rule. The four singular forms
already pass through unchanged (none end in a bare `s`); only the plural
spellings needed remapping.

**Verification:** TDD (`tests/tokenize.test.ts`), 173/173 green, clean
typecheck. Live: `search_docs("clearing cookies")` now returns
`chrome/claude-in-chrome-troubleshooting.md` as its top hit — the fix
verified against a real end-to-end query, not just the unit tests.

The `ancestorTf` depth-decay finding got no such reprieve — its blocking
condition (a full 3,995-heading resweep to tune a decay curve, matching the
rigor of the original `ancestorBoost` tuning) is a real methodology cost, not
a measurement gap, so it stays deferred.

---

## Phase 4 — finishing the project

The user asked for a plan to *finish* the project, not just pick the next
increment. Re-checked current state before planning rather than trusting an
older session's notes: `origin` now points at
`github.com/trmckinzie/claude-docs-mcp-server` and
`git rev-list --left-right --count origin/main...HEAD` returns `0  0` — the
earlier "no remote yet" open loop is already resolved, outside this session.
`npm test`/`typecheck`/`build` were all clean going in.

What remained was a 4-item unscheduled backlog, one deferred code-review
finding, and two long-standing "Open questions" below that had never been
resolved either way. Re-examining those open questions the same way 2.10
re-examined the cookie/movie deferral — verify against real, current state
before deciding — turned up the single best-justified piece of work left in
the project.

### Step 4.1 — index the document title

**Frontmatter `title` was parsed and denormalised onto every chunk for
display, but never tokenised into the index.** Checked how often that
actually matters, rather than assume: of all 283 real docs, **216 (76%)
have no H1 heading anywhere in the body** — the page's top-level section
starts at `##`, so the title text (the exact phrase a person is most likely
to type) never appears as any heading. Real examples:

| Path | Frontmatter title | First heading in body |
|---|---|---|
| `claude-code/advisor.md` | "Escalate hard decisions with the advisor tool" | "## When to use the advisor" |
| `claude-code/agent-sdk/agent-loop.md` | "How the agent loop works" | "## The loop at a glance" |
| `claude-code/admin-setup.md` | "Set up Claude Code for your organization" | "## Choose your API provider" |

Unlike the cookie/movie finding (5 words, a narrow lexical edge case), this
is a structural gap touching most of the corpus, and it goes straight at the
project's core purpose: finding the right doc from natural phrasing. The
other half of the same open question — frontmatter `tags` — closed the
opposite way: `grep -rl '^tags:' docs` finds **zero** real documents using
it. Nothing to index; not built.

**Design:** `Posting` gained `titleTf`, tracked apart from `ancestorTf` on
purpose — a document title is a document-level label, not an inherited
heading, and folding it into the field about to be closed as
"known-imperfect, don't touch" (below) would have undone that closure.
`titleTf` is attributed only to each document's first chunk (`src/build-
index.ts`), from tokenising `ParsedDoc.title` once per document. `rank.ts`
gained `titleBoost`, scored the same way `headingBoost`/`ancestorBoost` are.

**Tuned by sweep, not a guess** — same method as the `ancestorBoost` sweep at
2.7, adapted to what's actually being measured. A per-heading top-1 check
(the 2.7 method) doesn't fit here: a title-as-query is being ranked against
the *entire* 283-document corpus, not one document's own heading tree, so
some collisions on generic titles ("Examples," "Quickstart," "Overview") are
inherent, not a tuning failure. Measured top-1 and top-5 recall (top-5
matches `search_docs`'s own default `limit`) across all 283 real titles used
as their own query:

| `titleBoost` | top-1 | top-5 |
|---|---|---|
| 0 (baseline: title indexed but unweighted) | 18.7% | 43.8% |
| 1 | 46.6% | 78.8% |
| 2 (= `headingBoost`) | 66.1% | 87.3% |
| **5 (shipped)** | **88.0%** | **96.1%** |
| 8 | 90.5% | 96.5% |
| 12 | 91.2% | 96.5% |
| 20 | 91.9% | 97.5% |

5 sits right at the knee of the curve — the gains from 8 onward are
marginal (96.1% → 97.5% top-5 across a 4x boost increase), and pushing the
weight higher than needed risks generic titles distorting ordinary
body/heading queries elsewhere. The residual misses at 5 are legitimate
collisions, not bugs: `claude-code/agent-sdk/quickstart.md`, titled
"Quickstart," loses to `claude-code/quickstart.md` — a different, equally
valid "quickstart" doc.

That a title is weighted *above* `headingBoost` (5 vs 2) makes sense once
stated: for the 216 H1-less docs, the title is the *more* specific
descriptor of the first chunk, not the chunk's own often-generic first
heading ("Overview," "Getting started").

**Verification:** TDD (`tests/build-index.test.ts`, `tests/rank.test.ts`),
177/177 green, clean typecheck and build. Live, on the real server:
`search_docs("escalate hard decisions with the advisor")`,
`search_docs("how the agent loop works")`, and
`search_docs("set up claude code for your organization")` each now return
the exact intended document as the top hit — the same three titles that were
unreachable before this step (any query using their own wording matched
nothing, since none of those words appear in the corresponding body/heading
text).

### Step 4.2 — close the rest, instead of leaving it unscheduled

Re-verified once more; nothing changed the reasoning from rounds 2.8–2.10.
Rather than let these sit as "unscheduled" indefinitely, closing each with
one line of recorded reasoning:

- **Reindex on file change / cache index to disk** — no user-facing benefit:
  cold start is already sub-second against 283 docs, and `docs/` only
  changes via an explicit, infrequent `fetch-docs` run that already requires
  restarting the server process to pick up. **Won't build.**
- **`sourceLastMod` from the Help Center sitemap** — confirmed feasible
  (sitemap + `lastmod` verified live at 2.10) but optimization-only from the
  start; the existing content-hash comparison is already correct. **Won't
  build.**
- **Fundamentals-vs-advanced browse/learning-path tool** — flagged as its
  own scope-creep risk in three straight rounds (2.8, 2.9, 2.10). This
  project's job is search and discovery over a corpus, not a curriculum
  engine. **Out of scope, not "later."**
- **`Ranker` interface extraction** — real evidence exists (2/7 casual
  queries missed at 2.7) but there's still no second ranker implementation to
  justify the seam; building the interface first is exactly the "design for
  a hypothetical future requirement" CLAUDE.md warns against. **Accepted as
  a known limitation** of a pure-lexical tool. Reopen only alongside an
  actual plan to build a semantic/embedding ranker — that would be its own
  project.
- **`ancestorTf` depth-decay (deferred code-review finding)** — measured at
  2.7: 1 violation out of 3995 real headings, 15% score margin, and the
  losing chunk was only weakly on-topic to begin with. The only correct fix
  (a full corpus resweep at the same rigor as the `ancestorBoost` tuning)
  costs far more than it buys back. **Accepted as a documented limitation**,
  not a perpetually "deferred" item.

### Step 4.3 — repo hygiene for a real, pushed, public repository

Added `README.md` (setup, the `.mcp.json` workspace-trust approval gotcha
from 2.7, and one example per tool) and an MIT `LICENSE` — the repo has been
pushed to a public GitHub remote for a while, and PLAN.md's build log was
the only onboarding document that existed.

### Step 4.4 — sign-off

`npm test` (177/177), `typecheck`, and `build` all clean. `package.json`
bumped `0.1.0` → `1.0.0`: Phase 1–2's exit criteria were met and verified
end-to-end back at 2.7; this closes Phase 3/4 deliberately rather than
leaving them open-ended.

**What would reopen this:** a concrete new recall-gap query someone actually
hits (the way the title gap was found, not a hypothetical one), or a real
decision to build a semantic/embedding ranker as its own project.

---

## Phase 3 — backlog: closed (see Phase 4)

All remaining items — reindex-on-change, disk-cached index, `sourceLastMod`,
the `Ranker` interface, the fundamentals/advanced browse tool — were closed
at step 4.2 above with recorded reasoning, rather than left "unscheduled"
indefinitely. The one item that did clear the bar (indexing the document
title) shipped at step 4.1.

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

## Open questions — resolved at Phase 4

1. ~~Should frontmatter `tags` and document titles be indexed?~~ **Title:
   yes** — built at step 4.1, a real gap affecting 216/283 real docs.
   **Tags: no** — zero real documents use the field; nothing to index.
2. ~~Does a hand-written `notes/` directory get created now, or wait?~~
   **No** — the project is closing out at Phase 4; PLAN.md remains the
   single source of truth for design decisions.
