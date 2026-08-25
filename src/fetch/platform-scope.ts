/**
 * The curated slice of platform.claude.com in scope for this corpus: the
 * "how Claude thinks and can be directed" layer -- prompting, reasoning,
 * tool use, skills, MCP -- not the ~500-page API/billing/admin reference.
 * See PLAN.md 2.6.5 "Decision: what gets fetched."
 *
 * Built against the real 612-URL list from platform's `llms-full.txt`, not a
 * guessed set of paths. `/docs/en/api/` is excluded unconditionally, even
 * from an otherwise-included topic -- a first pass filtering by keyword alone
 * pulled in raw CRUD reference endpoints (`/api/skills/create`,
 * `/api/admin/mcp_tunnels/reveal_token`) purely because "skills" or "mcp"
 * appeared in the path.
 */

const INCLUDED_PREFIXES = [
  "/docs/en/build-with-claude/extended-thinking",
  "/docs/en/build-with-claude/thinking",
  "/docs/en/build-with-claude/context-editing",
  "/docs/en/build-with-claude/context-windows",
  "/docs/en/build-with-claude/prompt-caching",
  "/docs/en/build-with-claude/prompt-engineering/",
  "/docs/en/build-with-claude/skills-guide",
  "/docs/en/agents-and-tools/tool-use/",
  "/docs/en/agents-and-tools/agent-skills/",
  "/docs/en/agents-and-tools/mcp-connector",
  "/docs/en/agents-and-tools/mcp-tunnels/",
  "/docs/en/managed-agents/mcp-connector",
  "/docs/en/managed-agents/skills",
] as const;

const EXCLUDED_PREFIX = "/docs/en/api/";

export function isInPlatformScope(sourceUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return false;
  }

  if (url.hostname !== "platform.claude.com") return false;
  if (url.pathname.startsWith(EXCLUDED_PREFIX)) return false;

  return INCLUDED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}
