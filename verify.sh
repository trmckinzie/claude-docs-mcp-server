#!/usr/bin/env bash
# Full local check suite, in the order that fails fastest and cheapest first.
# Run before pushing; the pre-push hook in .claude/githooks also runs this
# automatically (warn-only) if it finds this file.
#
# No eslint here: there isn't one configured, and `tsc --strict` is the lint
# for this repo (see tsconfig.json). Typecheck below covers that role.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# The dev root's git hooks, its secret check among them, are wired through a
# relative core.hooksPath that git resolves from each worktree's own top level,
# so from the wrong depth they silently never run. Warn at the start and again
# at exit, never fail: CI sets no hooksPath, and this must not block a run.
hooks="$(git config --type=path --get core.hooksPath 2>/dev/null || true)"
if [ -n "$hooks" ]; then
  case "$hooks" in
    /*|[A-Za-z]:*) hooks_dir="$hooks" ;;
    *) hooks_dir="$ROOT/$hooks" ;;
  esac
  if [ ! -f "$hooks_dir/pre-commit" ]; then
    HOOKS_WARNING="WARNING: git hooks do not resolve from this worktree (core.hooksPath is $hooks), so commits made here skip the secret check."
    echo "$HOOKS_WARNING" >&2
    trap 'echo "$HOOKS_WARNING" >&2' EXIT
  fi
fi

echo "== typecheck =="
npm run typecheck

echo "== test =="
npm test

echo "verify.sh: all checks passed"
