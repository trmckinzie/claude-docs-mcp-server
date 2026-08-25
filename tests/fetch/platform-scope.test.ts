import { describe, expect, it } from "vitest";
import { isInPlatformScope } from "../../src/fetch/platform-scope.js";

/**
 * Encodes the curated-slice decision from PLAN.md 2.6.5: the "how Claude
 * thinks and can be directed" layer, not the ~500-page API/billing/admin
 * reference. Built against the real 612-URL list from platform's
 * llms-full.txt, not a guessed set of paths.
 */
describe("isInPlatformScope", () => {
  it("includes extended thinking, context management, and prompt caching", () => {
    expect(isInPlatformScope("https://platform.claude.com/docs/en/build-with-claude/extended-thinking")).toBe(true);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/build-with-claude/thinking")).toBe(true);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting")).toBe(true);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/build-with-claude/context-editing")).toBe(true);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/build-with-claude/context-windows")).toBe(true);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/build-with-claude/prompt-caching")).toBe(true);
  });

  it("includes the full prompt engineering guide", () => {
    expect(isInPlatformScope("https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview")).toBe(true);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices")).toBe(true);
  });

  it("includes tool use, agent skills, and MCP connector/tunnel guides", () => {
    expect(isInPlatformScope("https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview")).toBe(true);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool")).toBe(true);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview")).toBe(true);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/agents-and-tools/mcp-connector")).toBe(true);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/agents-and-tools/mcp-tunnels/overview")).toBe(true);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/managed-agents/mcp-connector")).toBe(true);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/managed-agents/skills")).toBe(true);
  });

  it("excludes everything under /api/, even a path that otherwise matches an included topic", () => {
    // The near-miss this test guards: a loose keyword filter over the real
    // 612-URL list pulled in raw CRUD reference endpoints for skills and MCP
    // tunnels (create/delete/retrieve/list) purely because "skills" or "mcp"
    // appeared in the path. Those serve someone integrating the API
    // commercially -- explicitly out of scope regardless of topic overlap.
    expect(isInPlatformScope("https://platform.claude.com/docs/en/api/skills/create")).toBe(false);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/api/beta/skills/versions/list")).toBe(false);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/api/admin/mcp_tunnels/reveal_token")).toBe(false);
  });

  it("excludes unrelated reference, billing, and getting-started pages", () => {
    expect(isInPlatformScope("https://platform.claude.com/docs/en/home")).toBe(false);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/get-started")).toBe(false);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/get-api-key")).toBe(false);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/api/messages/create")).toBe(false);
    expect(isInPlatformScope("https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/python")).toBe(false);
  });

  it("excludes a URL from a different host entirely", () => {
    expect(isInPlatformScope("https://code.claude.com/docs/en/agent-sdk/overview")).toBe(false);
  });
});
