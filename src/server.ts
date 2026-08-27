/**
 * MCP tool registration: `search_docs` and `get_doc` over an already-built
 * index. Takes the index as a parameter rather than loading it itself, so it
 * can be exercised in tests without a transport or a filesystem. See PLAN.md
 * step 2.6.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Index } from "./build-index.js";
import type { ChangelogEntry } from "./fetch/changelog.js";
import { summarizeChanges } from "./fetch/changelog.js";
import { listDocuments, listSections } from "./list-docs.js";
import { search, SEARCH_DEFAULTS } from "./search.js";
import type { SearchHit } from "./search.js";

const SERVER_INFO = { name: "claude-mcp-server", version: "0.1.0" };

/** Matches SEARCH_DEFAULTS.limit's role for search_docs: small enough that a
 * digest stays worth reading, big enough to cover a normal sync cadence. */
const RECENT_CHANGES_DEFAULT_LIMIT = 5;

export function createServer(index: Index, changelog: ChangelogEntry[] = []): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    "search_docs",
    {
      title: "Search docs",
      description:
        "Search the local documentation corpus and return ranked excerpts, " +
        "each with the path and anchor needed to fetch the full section.",
      inputSchema: {
        query: z.string().describe("What to search for"),
        limit: z
          .number()
          .int()
          .positive()
          .max(20)
          .optional()
          .describe(`Maximum number of results (default ${String(SEARCH_DEFAULTS.limit)})`),
      },
    },
    ({ query, limit }) => {
      const hits = search(index, query, limit === undefined ? {} : { limit });
      if (hits.length === 0) {
        return {
          content: [{ type: "text", text: `No results for "${query}".` }],
        };
      }
      return {
        content: [{ type: "text", text: hits.map(formatHit).join("\n\n---\n\n") }],
      };
    },
  );

  server.registerTool(
    "get_doc",
    {
      title: "Get document section",
      description:
        "Fetch one full section of a document by the path and anchor " +
        "search_docs returned. Omit anchor for the section before the first heading.",
      inputSchema: {
        path: z.string().describe("Document path, as returned by search_docs"),
        anchor: z
          .string()
          .optional()
          .describe("Section anchor, as returned by search_docs; omit for the lead section"),
      },
    },
    ({ path, anchor }) => {
      const chunk = index.chunks.find(
        (candidate) => candidate.path === path && (candidate.anchor ?? null) === (anchor ?? null),
      );
      if (chunk === undefined) {
        const where = anchor === undefined ? path : `${path}#${anchor}`;
        return {
          isError: true,
          content: [{ type: "text", text: `No section found at ${where}.` }],
        };
      }
      const title = chunk.heading ?? chunk.title;
      return {
        content: [{ type: "text", text: `# ${title}\n\n${chunk.text}` }],
      };
    },
  );

  server.registerTool(
    "recent_changes",
    {
      title: "Recent doc changes",
      description:
        "Show what changed in the documentation corpus across the most recent " +
        "syncs -- pages added, updated, or removed. Push-shaped, unlike " +
        "search_docs: use this to check what's new rather than to look " +
        "something specific up.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .max(20)
          .optional()
          .describe(`Maximum number of sync entries (default ${String(RECENT_CHANGES_DEFAULT_LIMIT)})`),
      },
    },
    ({ limit }) => ({
      content: [
        { type: "text", text: summarizeChanges(changelog, limit ?? RECENT_CHANGES_DEFAULT_LIMIT) },
      ],
    }),
  );

  server.registerTool(
    "list_docs",
    {
      title: "List corpus sections or documents",
      description:
        "Discover what's in the documentation corpus. Called with no " +
        "arguments, lists every top-level section and how many documents " +
        "it has. Given a section, lists that section's documents by path " +
        "and title. Use this to orient yourself in the corpus, not to " +
        "fetch content -- use search_docs or get_doc for that.",
      inputSchema: {
        section: z
          .string()
          .optional()
          .describe("A section name from a prior list_docs call; omit to list sections"),
      },
    },
    ({ section }) => {
      if (section === undefined) {
        const text = listSections(index)
          .map((s) => `${s.section} (${String(s.count)})`)
          .join("\n");
        return { content: [{ type: "text", text }] };
      }
      const docs = listDocuments(index, section);
      if (docs.length === 0) {
        return {
          content: [{ type: "text", text: `No documents in section "${section}".` }],
        };
      }
      return {
        content: [
          { type: "text", text: docs.map((d) => `${d.path} — ${d.title}`).join("\n") },
        ],
      };
    },
  );

  return server;
}

function formatHit(hit: SearchHit): string {
  const where = hit.headingPath.length > 0 ? hit.headingPath.join(" > ") : hit.title;
  const location = hit.anchor === null ? hit.path : `${hit.path}#${hit.anchor}`;
  return `${hit.title} — ${where}\n${location} (line ${String(hit.startLine)})\n\n${hit.snippet}`;
}
