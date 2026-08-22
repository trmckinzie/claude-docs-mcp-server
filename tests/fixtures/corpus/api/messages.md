---
title: Messages API
source_url: https://docs.claude.com/en/api/messages
updated: 2026-08-10
tags: api, messages, streaming
---

The Messages API is the primary endpoint for sending a conversation to a model
and receiving a reply.

## Request shape

A request carries a model id, a max_tokens limit, and an ordered list of
messages. Every message pairs a role with its content.

## Streaming

Set stream to true to receive events as they are produced. The server emits
incremental content blocks until a message_stop event closes the response.
