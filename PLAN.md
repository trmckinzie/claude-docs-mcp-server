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

### 2.1 — Parser: frontmatter + chunking
`parseDoc(raw, path) -> { meta, chunks[] }`

- Split `---` frontmatter with a hand-rolled minimal `key: value` parser (~30
  lines, our schema, no dep). Escalate to `gray-matter` only if the schema
  outgrows it. Reversible decision.
- Chunk the body **by heading**: each `##`/`###` starts a chunk carrying its
  heading path (`Transports > stdio`) and a stable anchor id.
- Content above the first heading becomes a lead chunk.

Tests: no frontmatter · malformed frontmatter · empty file · no headings ·
nested headings · a `#` inside a code fence must not split a chunk.

### 2.2 — Tokenizer
`tokenize(text) -> string[]`

Lowercase; split on non-alphanumerics but keep intra-word `-` `.` `+` `#` so
`claude-code`, `4.5`, `c++` survive. Strip a small stopword list. Plural folding
only if tests show it helps.

Tests: `"MCP stdio transport"` · `claude-code` stays one token · punctuation-only
input · unicode · empty string.

### 2.3 — Index
`buildIndex(docs[]) -> Index` — inverted index (term → postings) plus per-chunk
length, average length, document frequency.

Tests: term in 2 of 3 chunks has df=2 · avgdl math · rebuild is deterministic ·
empty corpus doesn't throw.

### 2.4 — BM25 ranker
`rank(index, queryTokens, opts) -> ScoredChunk[]`

Standard BM25 plus a **field boost**: heading-path matches weighted above body
matches (start 2.0×, tune against fixtures). Ties broken by path for determinism.

Tests: known-corpus scores asserted to 2 decimals · exact ordering for 3 sample
queries · a term present in every chunk contributes ~0 (idf floor) · unknown term
returns `[]` · a long chunk doesn't beat a short focused one at equal term count.

### 2.5 — `search()` facade
`search(query, { limit = 5, maxChars })` → `{ path, anchor, headingPath, score, snippet }[]`

Snippet = matched window with query terms centered, hard-capped so a response
can't blow up context. **That cap is the entire point of this server** — assert it.

Tests: respects `limit` · snippet never exceeds `maxChars` · snippet contains at
least one query term · stable ordering.

### 2.6 — MCP server wiring
First step that touches I/O. `src/index.ts`: stdio transport, tool registration.

- `search_docs(query, limit?)` → ranked hits with snippets
- `get_doc(path, anchor?)` → one full chunk, for when a snippet isn't enough

Loader walks `docs/`, reads files, feeds the 2.1–2.5 pipeline.

Tests: tool schemas validate · handler returns MCP-shaped content · unknown
`path` in `get_doc` returns an error result rather than throwing · **nothing
reaches stdout except protocol frames**.

### 2.7 — Run it for real
- `npm run dev` smoke test against a hand-typed query
- Register in `.mcp.json`, restart Claude Code, confirm the tool appears
- Drop 3–4 real docs into `docs/` and eyeball the top hits

**Exit criteria:** I ask you a question about MCP and you answer by calling
`search_docs` — not from memory, and not from a context dump.

---

## Phase 3 — backlog (unscheduled)

- Reindex on file change (`fs.watch`) rather than on boot
- Cache index to disk; skip reparse when mtimes are unchanged
- `list_docs` tool for corpus discovery
- Extract a `Ranker` interface if lexical recall proves too brittle
- Freshness warning when a doc's `updated:` frontmatter goes stale

## Open questions

1. Does `docs/` get committed, or stay gitignored as a local corpus?
2. Where do the docs come from — manual curation, or a fetch script?
3. Do we want `source_url` in frontmatter so you can cite where a snippet came from?
