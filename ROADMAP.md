# claude-mcp-server roadmap

Done when: every PLAN.md phase is ticked, `verify.sh` (typecheck + tests) is green in CI, and the `docs/` corpus was refreshed within the last 30 days.

Tier: code. See `90_Meta/Dev Environment Standard.md` in the dev vault. The build history and phase detail live in [PLAN.md](PLAN.md); this file only tracks what stands between the repo and its Done line.

## Standardize
- [x] Pin Node in `.nvmrc` (24)
- [x] `verify.sh`: `tsc` strict (the lint here) plus vitest, 205 tests
- [x] CI: `npm ci` + `verify.sh`, actions pinned to a SHA, `contents: read`. Tests run on fixtures only, so CI needs no corpus
- [x] `dashboard.json` with `test`, `verify` and `fetch-docs`

## Harden
- [x] 2026-10-09: `npm audit fix` (non-breaking) cleared 4 advisories pulled in through the MCP SDK, including a critical in `proxy-addr`. Unreachable from a stdio server, but this repo is public; now 0, 205 tests green

- [x] 2026-10-09, refresh blocked by a duplicate in upstream's index: `code.claude.com`'s `llms-full.txt` listed 8 pages twice, byte for byte, and the collision check refused the whole run. `dropIdenticalDuplicates` now keeps one copy; a real collision (same path, different content) still fails
- [x] 2026-10-09, discovery broken and silently destructive: support.claude.com's homepage moved most article links into embedded JSON, so the `href`-only match found no in-scope articles. That read as "all deleted" and removed 41 Help Center pages from disk. Fixed both halves: `extractArticleUrls` matches URLs anywhere in the page, and `findVanishedSites` refuses a run where a source that had pages now returns none

## Reach done
- [x] Every PLAN.md phase ticked
- [x] Refresh the corpus (`npm run fetch-docs`). Refreshed 2026-10-09: 314 pages (221 Claude Code, 55 platform, 36 Help Center); 42 added, 15 gone upstream
- [x] Committed and pushed as `7e14e65`; CI green 2026-10-09. **Done line met.**

## Maintenance (recurring)
- [ ] Refresh the corpus every 30 days. After each refresh, move this item's due date 30 days on (due 2026-11-08)
