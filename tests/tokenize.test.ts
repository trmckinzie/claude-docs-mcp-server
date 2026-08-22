import { describe, expect, it } from "vitest";
import { STOPWORDS, tokenize, tokenizePositions } from "../src/tokenize.js";

describe("tokenize", () => {
  it("lowercases and splits on whitespace", () => {
    expect(tokenize("MCP stdio transport")).toEqual(["mcp", "stdio", "transport"]);
  });

  it("keeps a hyphenated identifier as one token", () => {
    expect(tokenize("claude-code")).toEqual(["claude-code"]);
    expect(tokenize("JSON-RPC messages")).toEqual(["json-rpc", "message"]);
  });

  it("keeps version numbers and symbol-suffixed names intact", () => {
    expect(tokenize("Claude 4.5")).toEqual(["claude", "4.5"]);
    expect(tokenize("c++ and c#")).toEqual(["c++", "c#"]);
  });

  it("strips punctuation from token edges but not the middle", () => {
    expect(tokenize("`.mcp.json`")).toEqual(["mcp.json"]);
    expect(tokenize("Restart Claude Code, then stop.")).toEqual([
      "restart",
      "claude",
      "code",
      "stop",
    ]);
    expect(tokenize("--help")).toEqual(["help"]);
  });

  it("treats underscores as separators, so max_tokens is reachable as two words", () => {
    expect(tokenize("max_tokens")).toEqual(["max", "token"]);
    expect(tokenize("message_stop event")).toEqual(["message", "stop", "event"]);
  });

  it("drops stopwords", () => {
    expect(tokenize("the server is in the docs")).toEqual(["server", "doc"]);
    expect(STOPWORDS.has("the")).toBe(true);
    // Domain vocabulary must survive: these look like noise but are not.
    for (const term of ["set", "get", "no", "not", "all", "one", "use", "code"]) {
      expect(STOPWORDS.has(term), term).toBe(false);
    }
  });

  it("returns nothing for input that carries no meaning", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
    expect(tokenize("--- ... !?!")).toEqual([]);
    expect(tokenize("the and of to")).toEqual([]);
  });

  it("drops stray single letters left behind by possessives", () => {
    expect(tokenize("the server's stdin")).toEqual(["server", "stdin"]);
  });

  it("keeps non-ASCII letters rather than stripping them", () => {
    expect(tokenize("Configuración del café")).toEqual([
      "configuración",
      "del",
      "café",
    ]);
  });

  it("is pure -- same input, same output", () => {
    const input = "MCP stdio transport, claude-code, 4.5";
    expect(tokenize(input)).toEqual(tokenize(input));
  });
});

/**
 * Folding was deferred at 2.2 until it could be shown to help. Scanning the
 * corpus turned up nine singular/plural pairs across three documents --
 * servers/server, messages/message, requests/request and so on -- so a query
 * for "MCP servers" missed the document that says "server" throughout.
 */
describe("plural folding", () => {
  it("folds a trailing s so a plural query reaches singular prose", () => {
    expect(tokenize("MCP servers")).toEqual(["mcp", "server"]);
    expect(tokenize("responses")).toEqual(["response"]);
    expect(tokenize("settings")).toEqual(["setting"]);
    expect(tokenize("permissions")).toEqual(["permission"]);
  });

  it("folds -ies to -y", () => {
    expect(tokenize("entries")).toEqual(["entry"]);
  });

  it("leaves words that only look plural alone", () => {
    expect(tokenize("class")).toEqual(["class"]);
    expect(tokenize("process")).toEqual(["process"]);
    expect(tokenize("status")).toEqual(["status"]);
    expect(tokenize("analysis")).toEqual(["analysis"]);
    // Too short to risk the transform.
    expect(tokenize("js")).toEqual(["js"]);
    expect(tokenize("gas")).toEqual(["gas"]);
  });

  it("makes singular and plural queries agree", () => {
    expect(tokenize("MCP servers")).toEqual(tokenize("mcp server"));
    expect(tokenize("streaming responses")).toEqual(tokenize("streaming response"));
  });

  it("does not resurrect a stopword by folding it", () => {
    // "does" must not survive as "doe".
    expect(tokenize("does the server start")).toEqual(["server", "start"]);
  });
});

/** Snippet building needs to know where a match sits in the source text. */
describe("tokenizePositions", () => {
  it("reports where each token sits in the original text", () => {
    expect(tokenizePositions("The MCP server")).toEqual([
      { token: "mcp", start: 4, end: 7 },
      { token: "server", start: 8, end: 14 },
    ]);
  });

  it("spans the original word, not the folded token", () => {
    const text = "Restart the servers.";
    const hit = tokenizePositions(text)[1];
    expect(hit?.token).toBe("server");
    expect(text.slice(hit?.start ?? 0, hit?.end ?? 0)).toBe("servers");
  });

  it("agrees with tokenize, so highlighting cannot drift from matching", () => {
    const text = "MCP stdio transport, claude-code, 4.5 and c++ servers.";
    expect(tokenizePositions(text).map((p) => p.token)).toEqual(tokenize(text));
  });
});
