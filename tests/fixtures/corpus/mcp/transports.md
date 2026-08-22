---
title: MCP Transports
source_url: https://modelcontextprotocol.io/docs/concepts/transports
updated: 2026-08-01
tags: mcp, transport, stdio
---

Transports carry JSON-RPC messages between an MCP client and an MCP server.

## stdio

The stdio transport runs the server as a subprocess. The client writes requests
to standard input and reads responses from standard output.

Anything written to standard output that is not a protocol frame corrupts the
stream, so diagnostic logging belongs on standard error.

```bash
node dist/index.js
## this line is inside a fence and must not start a new chunk
```

### Framing

Each message is newline-delimited JSON, so a single message may never contain a
raw newline of its own.

## HTTP

The streamable HTTP transport exposes an MCP server at a URL. Reach for it when
the server runs remotely, or when one deployment serves many clients.
