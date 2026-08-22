---
title: Malformed Frontmatter
this line has no colon separator at all
tags: [unclosed
---

The delimiters close cleanly, but the block holds a line the minimal parser
cannot read as a key and value. It must skip what it cannot parse, keep what it
can, and never throw.

## Section

Body text below the bad block.
