---
title: Claude Code Settings
source_url: https://docs.claude.com/en/docs/claude-code/settings
updated: 2026-07-15
tags: claude-code, settings, configuration
---

Claude Code merges settings from the project directory and the user home
directory, with project values taking precedence.

## Permissions

The permissions block holds allow and deny rules for tools. A deny rule always
wins over an allow rule that would otherwise match.

## Declaring servers

Project-level MCP entries live in `.mcp.json`. Each entry names a command and
its arguments, and Claude Code launches that server as a child process on start.
