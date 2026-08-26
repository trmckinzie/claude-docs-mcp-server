import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildIndex } from "../src/build-index.js";
import type { Index } from "../src/build-index.js";
import type { ChangelogEntry } from "../src/fetch/changelog.js";
import { parseDoc } from "../src/parse-doc.js";
import { createServer } from "../src/server.js";
import { loadFixtures } from "./fixtures/load.js";

async function corpusIndex(): Promise<Index> {
  const docs = await loadFixtures("corpus");
  return buildIndex(docs.map((d) => parseDoc(d.raw, d.path)));
}

/**
 * Wires a real MCP Client to the real server object over an in-process
 * transport, so every assertion below exercises the actual protocol path --
 * schema validation, request routing, result shaping -- not our handlers in
 * isolation.
 */
async function connectedClient(index: Index, changelog: ChangelogEntry[] = []) {
  const server = createServer(index, changelog);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return { client, server };
}

describe("createServer", () => {
  let cleanup: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  it("advertises search_docs, get_doc, and recent_changes with input schemas", async () => {
    const { client, server } = await connectedClient(await corpusIndex());
    cleanup = () => Promise.all([client.close(), server.close()]).then(() => undefined);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_doc", "recent_changes", "search_docs"]);

    const searchDocs = tools.find((t) => t.name === "search_docs");
    expect(searchDocs?.inputSchema.properties).toHaveProperty("query");
    const getDoc = tools.find((t) => t.name === "get_doc");
    expect(getDoc?.inputSchema.properties).toHaveProperty("path");
  });

  it("returns ranked, MCP-shaped content for a real query", async () => {
    const { client, server } = await connectedClient(await corpusIndex());
    cleanup = () => Promise.all([client.close(), server.close()]).then(() => undefined);

    const result = await client.callTool({
      name: "search_docs",
      arguments: { query: "streaming events" },
    });

    expect(result.isError).toBeFalsy();
    expect(Array.isArray(result.content)).toBe(true);
    const [block] = result.content as Array<{ type: string; text: string }>;
    expect(block?.type).toBe("text");
    expect(block?.text).toContain("api/messages.md");
    expect(block?.text.toLowerCase()).toContain("streaming");
  });

  it("respects the limit argument", async () => {
    const { client, server } = await connectedClient(await corpusIndex());
    cleanup = () => Promise.all([client.close(), server.close()]).then(() => undefined);

    const result = await client.callTool({
      name: "search_docs",
      arguments: { query: "server", limit: 1 },
    });
    const [block] = result.content as Array<{ type: string; text: string }>;
    // Hits are separated by a rule; one hit means the rule never appears.
    expect(block?.text).not.toContain("\n---\n");
  });

  it("reports no results without erroring, for a query that matches nothing", async () => {
    const { client, server } = await connectedClient(await corpusIndex());
    cleanup = () => Promise.all([client.close(), server.close()]).then(() => undefined);

    const result = await client.callTool({
      name: "search_docs",
      arguments: { query: "notacorpusword" },
    });
    expect(result.isError).toBeFalsy();
    const [block] = result.content as Array<{ type: string; text: string }>;
    expect(block?.text.toLowerCase()).toContain("no results");
  });

  it("catches a malformed argument in schema validation, before the handler runs", async () => {
    const { client, server } = await connectedClient(await corpusIndex());
    cleanup = () => Promise.all([client.close(), server.close()]).then(() => undefined);

    // This SDK version turns a schema-validation failure into a normal
    // CallToolResult with isError: true, rather than a rejected request --
    // confirmed by reading server/mcp.js rather than assumed. The behaviour
    // worth asserting either way is that a wrong-typed argument never reaches
    // our handler: a string "limit" would throw inside search() if it did.
    const result = await client.callTool({
      name: "search_docs",
      arguments: { query: "server", limit: "not-a-number" },
    });
    expect(result.isError).toBe(true);
    const [block] = result.content as Array<{ type: string; text: string }>;
    expect(block?.text).toMatch(/invalid|validation/i);
  });

  it("fetches a full chunk by path and anchor", async () => {
    const { client, server } = await connectedClient(await corpusIndex());
    cleanup = () => Promise.all([client.close(), server.close()]).then(() => undefined);

    const result = await client.callTool({
      name: "get_doc",
      arguments: { path: "claude-code/settings.md", anchor: "permissions" },
    });
    expect(result.isError).toBeFalsy();
    const [block] = result.content as Array<{ type: string; text: string }>;
    expect(block?.text).toContain("deny rule always");
  });

  it("fetches the lead chunk when no anchor is given", async () => {
    const { client, server } = await connectedClient(await corpusIndex());
    cleanup = () => Promise.all([client.close(), server.close()]).then(() => undefined);

    const result = await client.callTool({
      name: "get_doc",
      arguments: { path: "mcp/transports.md" },
    });
    const [block] = result.content as Array<{ type: string; text: string }>;
    expect(block?.text).toContain("Transports carry JSON-RPC");
  });

  it("returns an error result, not a thrown exception, for an unknown path", async () => {
    const { client, server } = await connectedClient(await corpusIndex());
    cleanup = () => Promise.all([client.close(), server.close()]).then(() => undefined);

    const result = await client.callTool({
      name: "get_doc",
      arguments: { path: "does/not-exist.md" },
    });
    expect(result.isError).toBe(true);
    const [block] = result.content as Array<{ type: string; text: string }>;
    expect(block?.text.toLowerCase()).toContain("no section found");
  });

  it("returns an error result for a real path with an anchor that does not exist", async () => {
    const { client, server } = await connectedClient(await corpusIndex());
    cleanup = () => Promise.all([client.close(), server.close()]).then(() => undefined);

    const result = await client.callTool({
      name: "get_doc",
      arguments: { path: "mcp/transports.md", anchor: "not-a-real-anchor" },
    });
    expect(result.isError).toBe(true);
  });

  it("returns the changelog digest for recent_changes", async () => {
    const changelog: ChangelogEntry[] = [
      { fetchedAt: "2026-08-24T00:00:00.000Z", added: ["claude-code/new-page.md"], updated: [], gone: [] },
    ];
    const { client, server } = await connectedClient(await corpusIndex(), changelog);
    cleanup = () => Promise.all([client.close(), server.close()]).then(() => undefined);

    const result = await client.callTool({ name: "recent_changes", arguments: {} });
    expect(result.isError).toBeFalsy();
    const [block] = result.content as Array<{ type: string; text: string }>;
    expect(block?.text).toContain("claude-code/new-page.md");
  });

  it("reports no history without erroring, when the changelog is empty", async () => {
    const { client, server } = await connectedClient(await corpusIndex(), []);
    cleanup = () => Promise.all([client.close(), server.close()]).then(() => undefined);

    const result = await client.callTool({ name: "recent_changes", arguments: {} });
    expect(result.isError).toBeFalsy();
    const [block] = result.content as Array<{ type: string; text: string }>;
    expect(block?.text.toLowerCase()).toContain("no changes recorded");
  });

  it("respects a limit argument on recent_changes", async () => {
    const changelog: ChangelogEntry[] = [
      { fetchedAt: "a", added: ["old.md"], updated: [], gone: [] },
      { fetchedAt: "b", added: ["new.md"], updated: [], gone: [] },
    ];
    const { client, server } = await connectedClient(await corpusIndex(), changelog);
    cleanup = () => Promise.all([client.close(), server.close()]).then(() => undefined);

    const result = await client.callTool({ name: "recent_changes", arguments: { limit: 1 } });
    const [block] = result.content as Array<{ type: string; text: string }>;
    expect(block?.text).toContain("new.md");
    expect(block?.text).not.toContain("old.md");
  });
});

describe("stdio transport", () => {
  it("writes nothing to stdout except newline-delimited JSON-RPC frames", async () => {
    const index = await corpusIndex();
    const server = createServer(index);

    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const written: Buffer[] = [];
    stdout.on("data", (chunk: Buffer) => written.push(chunk));

    const transport = new StdioServerTransport(stdin, stdout);
    await server.connect(transport);

    const request = {
      jsonrpc: "2.0" as const,
      id: 1,
      method: "tools/call",
      params: { name: "search_docs", arguments: { query: "stdio" } },
    };
    stdin.write(`${JSON.stringify(request)}\n`);

    await vi.waitFor(() => {
      if (written.length === 0) throw new Error("no response yet");
    });

    await server.close();

    const raw = Buffer.concat(written).toString("utf8");
    const lines = raw.split("\n").filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // Every byte on stdout must be part of a JSON-RPC frame. A stray
      // console.log would show up here as a line json.parse rejects.
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
