# claude-mcp-server

A local MCP server that mirrors Anthropic's published documentation (Claude
Code, the Claude Platform, Cowork, Desktop, Chrome, Mobile — 283 pages) into
a searchable index, and exposes it to Claude Code as tools. The point:
Claude looks up its own current instructions on demand instead of carrying
a stale doc dump in context, or answering from memory.

Ranking is in-memory BM25 over the real corpus — no network calls at query
time, no model, no vector store. See [PLAN.md](PLAN.md) for the full design
history and every decision behind it.

## Setup

```bash
npm install
npm run fetch-docs
```

`fetch-docs` pulls the corpus into `docs/` (gitignored — it's a rebuildable
mirror, not a work product; see [PLAN.md](PLAN.md#docs-is-a-cache-not-a-work-product--settled)).
Re-run it any time to refresh; it only refetches what actually changed.

## Registering it with Claude Code

This repo already commits a project-scoped `.mcp.json`. From a fresh clone,
Claude Code needs one interactive approval before it will load the server:

```bash
claude
```

Run that once and accept the prompt. Until you do, `claude mcp list` will
show `claude-docs` stuck as `⏸ Pending approval` and its tools won't appear
in any session — this is a workspace-trust gate, not a bug (a committed
`.mcp.json` could otherwise run an arbitrary command on clone). After
approval, `claude mcp list` should show `claude-docs ... ✔ Connected`.

## Tools

- **`search_docs(query, limit?)`** — ranked excerpts with path + anchor.
  ```
  search_docs("how do I configure permissions in claude code")
  ```
- **`get_doc(path, anchor?)`** — the full section behind a `search_docs` hit.
  ```
  get_doc("claude-code/settings.md", "permissions")
  ```
- **`list_docs(section?)`** — corpus discovery: no argument lists sections
  and counts; a section name lists its documents.
  ```
  list_docs("cowork")
  ```
- **`recent_changes(limit?)`** — what changed across the last few syncs
  (added / updated / removed), for catching up rather than looking something
  specific up.
  ```
  recent_changes()
  ```

## Development

```bash
npm test         # vitest
npm run typecheck
npm run build
```

TDD is mandatory in this repo — see [CLAUDE.md](CLAUDE.md) for the workflow
this project follows for every change.
