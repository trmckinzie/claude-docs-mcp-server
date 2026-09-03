import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { fetchWithSafeRedirects } from "../../src/fetch/safe-fetch.js";

/**
 * Exercises the redirect-following behavior against a real local HTTP
 * server rather than a stubbed `fetch`, so the test covers the actual
 * `redirect: "manual"` + `Location` header handling, not a mock of it. The
 * `validate` callback stands in for `assertSafeFetchUrl`: production wires
 * the real allowlist, these tests wire one scoped to the ephemeral local
 * ports the server listens on.
 */

async function listen(
  handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected an AddressInfo from server.listen(0, ...)");
  }
  return { server, url: `http://127.0.0.1:${String(address.port)}` };
}

describe("fetchWithSafeRedirects", () => {
  let servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    servers = [];
  });

  it("rejects a redirect that resolves to a disallowed host", async () => {
    const disallowed = await listen((_req, res) => {
      res.writeHead(200);
      res.end("should never be reached");
    });
    servers.push(disallowed.server);

    const redirecting = await listen((_req, res) => {
      res.writeHead(302, { Location: disallowed.url });
      res.end();
    });
    servers.push(redirecting.server);

    // Only the redirecting server's own origin is on the test allowlist --
    // the disallowed server is a different port, standing in for a
    // different host.
    const validate = (url: string): void => {
      if (!url.startsWith(redirecting.url)) {
        throw new Error(`Host not on the fetch allowlist: ${url}`);
      }
    };

    await expect(fetchWithSafeRedirects(redirecting.url, { validate })).rejects.toThrow(
      /not on the fetch allowlist/,
    );
  });

  it("follows a redirect that resolves to an allowed host and returns its response", async () => {
    const target = await listen((_req, res) => {
      res.writeHead(200);
      res.end("final body");
    });
    servers.push(target.server);

    const redirecting = await listen((_req, res) => {
      res.writeHead(302, { Location: target.url });
      res.end();
    });
    servers.push(redirecting.server);

    // Both origins are allowed this time.
    const validate = (url: string): void => {
      if (!url.startsWith(target.url) && !url.startsWith(redirecting.url)) {
        throw new Error(`Host not on the fetch allowlist: ${url}`);
      }
    };

    const response = await fetchWithSafeRedirects(redirecting.url, { validate });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("final body");
  });

  it("gives up after the configured number of redirect hops", async () => {
    const looping = await listen((req, res) => {
      // Every request redirects to itself -- an infinite loop without a cap.
      res.writeHead(302, { Location: `http://127.0.0.1:${String((req.socket.localPort as number))}` });
      res.end();
    });
    servers.push(looping.server);

    const validate = (): void => {
      // Nothing to reject here -- the point of this test is the hop cap.
    };

    await expect(
      fetchWithSafeRedirects(looping.url, { validate, maxRedirects: 2 }),
    ).rejects.toThrow(/exceeded 2 redirects/i);
  });
});
