---
title: Unterminated Frontmatter
tags: broken

This file opens a frontmatter block and never closes it. The parser has to pick
a behaviour -- treat the whole file as body, or swallow it as frontmatter -- and
step 2.1 pins that choice in a test.
