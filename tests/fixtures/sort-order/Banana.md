Uppercase-first filename, used to distinguish locale-collation sort from
codepoint sort: in codepoint order, "Banana.md" (starts 0x42) sorts before
"apple.md" (starts 0x61). In locale-aware collation (localeCompare), it's the
reverse -- almost every locale treats case as a tiebreaker, not the primary
sort key, so "apple" sorts before "Banana".
