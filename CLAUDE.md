# claude-mcp-server

Local MCP server that indexes a Markdown corpus in `docs/` and exposes a
`search_docs` tool, so Claude can fetch its own current instructions on demand
instead of carrying them in context.

Stack: Node 24 · TypeScript (ESM) · `@modelcontextprotocol/sdk` · Vitest

## Workflow — every change follows this loop

1. **EXPLORE** — Read the relevant files first. Never edit a file you haven't read.
2. **PLAN** — State the approach and the test cases before touching code. For
   anything beyond a one-line fix, get my sign-off on the plan.
3. **TEST** — Write the failing test first. Watch it fail for the right reason.
4. **CODE** — Minimum implementation to go green. Refactor after.

Don't skip a step because a change "looks small." If a step is genuinely
unnecessary, say so and why — don't silently drop it.

## TDD is mandatory

- No implementation code lands without a test written **before** it.
- A test that has never failed has proven nothing. See it red first.
- Bug fix = reproduce with a failing test, then fix.
- `npm test` must be green before you tell me something is done. If it isn't
  green, say so and paste the output.
- Never edit a test to make failing code pass. Fix the code — or tell me the
  expectation was wrong and why.

## Context discipline

`docs/` is a reference corpus, not context. It exists so you can look things up.

- Pull a specific file with `@docs/path/to/file.md` when you need it.
- Once `search_docs` works, use it: query, read the top hits, stop.
- **For any question about Claude, Claude Code, Cowork, or MCP itself, call
  `search_docs` first** — before a general web-research agent, before
  `Glob`/`Grep` over `docs/`. Confirmed failure mode: asked "how do skills
  work" with no tool named explicitly, Claude reached for a research
  subagent, then a raw glob listing 100 files under `docs/`, before ever
  trying `search_docs`. Both are exactly the "dump the corpus into context"
  anti-pattern this project exists to avoid — a ranked, capped snippet from
  `search_docs` beats either.
- Never read all of `docs/` into context. Never `cat` a directory of Markdown
  "to get oriented." Retrieve the section you need, not the corpus.
- Same rule for source: read the files the task touches, not the whole tree.
- Unsure which doc covers something? Grep the headings first.

## Conventions

- ESM only (`"type": "module"`); `.js` extensions in relative imports.
- `src/` is implementation; `tests/` mirrors it 1:1.
- Indexing and ranking are pure functions — I/O stays at the edges. That's what
  keeps the ranker unit-testable without a live server.
- Logs go to **stderr**. stdout is the MCP transport — a stray `console.log`
  silently corrupts the protocol stream.
- Anything that fetches external content validates the host against an
  explicit allowlist, requires HTTPS, and treats the response as inert text —
  never executed, never eval'd. Applies to `scripts/fetch-docs.ts` and to
  whatever fetches something next.

## Model routing

Sonnet executes, Opus escalates, Fable only on Travis's explicit say-so. This repo's subagents
live in `.claude/agents/`; the doctrine they point to is `90_Meta/Model Routing.md` in the dev
mono-vault containing this repo — personal workflow config, not part of this project.
