import { describe, expect, it } from "vitest";

import { readAgentName } from "@/lib/mcp/agent-identity";

/**
 * The name goes into an audit trail, so the question is not only what it
 * recognises but what it refuses to claim.
 */
describe("naming the assistant that proposed a test", () => {
  it("prefers what MCP's own handshake says, with its version", () => {
    expect(readAgentName({ clientInfo: { name: "claude-code", version: "2.1.0" } })).toBe("Claude Code 2.1.0");
    expect(readAgentName({ clientInfo: { name: "Cursor" } })).toBe("Cursor");
  });

  it("falls back to the User-Agent, because this server keeps no session", () => {
    // The version is kept: "which tool, and which version" is what a trail is
    // asked later.
    expect(readAgentName({ userAgent: "Visual Studio Code/1.99 (Copilot)" })).toBe("VS Code 1.99");
    expect(readAgentName({ userAgent: "Windsurf/1.2" })).toBe("Windsurf 1.2");
    expect(readAgentName({ userAgent: "Claude Code/2.1.0 (mcp)" })).toBe("Claude Code 2.1.0");
    // None stated, so none invented.
    expect(readAgentName({ userAgent: "Cursor" })).toBe("Cursor");
  });

  it("says nothing rather than naming a runtime as the author", () => {
    // "node" in an audit trail reads as though something was established.
    for (const agent of ["node", "node-fetch/3.3", "undici", "curl/8.4.0", "python-requests/2.32", "okhttp/4.12"]) {
      expect(readAgentName({ userAgent: agent })).toBeNull();
    }
    expect(readAgentName({})).toBeNull();
    expect(readAgentName({ userAgent: "   " })).toBeNull();
  });

  it("keeps an unrecognised client's own name instead of discarding it", () => {
    expect(readAgentName({ userAgent: "SomeNewEditor/0.1" })).toBe("SomeNewEditor/0.1");
    expect(readAgentName({ clientInfo: { name: "some-new-agent", version: "9" } })).toBe("some-new-agent 9");
  });

  it("cannot be used to write control characters or unbounded text into the record", () => {
    const long = readAgentName({ clientInfo: { name: "x".repeat(400), version: "1" } });
    expect(long!.length).toBeLessThanOrEqual(120);
    // A control character must not silently join two words together.
    expect(readAgentName({ userAgent: "Some\u0000Editor\nBuild 3" })).toBe("Some Editor Build 3");
    expect(readAgentName({ userAgent: "z".repeat(400) })!.length).toBe(120);
  });
});
