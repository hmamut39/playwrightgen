import { NextRequest } from "next/server";

import { handleMcpMessage } from "@/lib/mcp/playwrightgen-mcp";
import { authenticateEditorRequest, type EditorSession } from "@/lib/services/editor-access";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 100_000;

type Dependencies = {
  authenticate: (authorization: string | null) => Promise<EditorSession | null>;
};

const defaultDependencies: Dependencies = {
  authenticate: (authorization) => authenticateEditorRequest(authorization),
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

/**
 * The MCP endpoint editors connect to (Streamable HTTP transport).
 *
 * Authenticated by a personal editor token rather than a browser session, so
 * Clerk's middleware does not run here -- the same arrangement as CI ingest.
 * Each POST carries one JSON-RPC message, or a batch from an older client, and
 * is answered with JSON; the server keeps no session and opens no stream.
 */
export async function handleMcpRequest(
  request: NextRequest,
  dependencies: Dependencies = defaultDependencies,
) {
  const session = await dependencies.authenticate(request.headers.get("authorization"));
  if (!session) {
    return json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "A valid PlaywrightGen editor token is required." } },
      401,
      { "www-authenticate": 'Bearer realm="playwrightgen"' },
    );
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, 413);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0 || payload.length > 20) {
      return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid batch" } }, 400);
    }
    const responses = [];
    for (const message of payload) {
      const response = await handleMcpMessage(message, session);
      if (response) responses.push(response);
    }
    return responses.length ? json(responses) : new Response(null, { status: 202 });
  }

  const response = await handleMcpMessage(payload, session);
  // Notifications and client responses are acknowledged without a body.
  return response ? json(response) : new Response(null, { status: 202 });
}

export function POST(request: NextRequest) {
  return handleMcpRequest(request);
}

/** No server-initiated stream is offered; the spec's answer to that is 405. */
export function GET() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
