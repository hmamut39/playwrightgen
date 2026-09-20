/**
 * Proof to the official MCP registry that playwrightgen.com publishes this
 * server.
 *
 * The registry reads this file when `mcp-publisher login http` signs a
 * challenge with the matching private key, which proves the publisher controls
 * this domain and grants the `com.playwrightgen/*` namespace. Only the public
 * key is here; the private key lives outside the repository.
 *
 * https://modelcontextprotocol.io/registry/authentication
 */
const PUBLIC_KEY = "M/Murzrj0nVrgoIV/Dtqk9IYMLlxjvMX3lY1GJRP9p4=";

export const dynamic = "force-static";

export function GET() {
  return new Response(`v=MCPv1; k=ed25519; p=${PUBLIC_KEY}`, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
