/**
 * Which assistant proposed this.
 *
 * A test case that arrived over MCP is recorded as AI_SUGGESTED, which says an
 * AI made it and nothing else. That was enough when an assistant proposing a
 * test was unusual. It is not enough now: traceability for AI-assisted work is
 * expected to say *which* tool produced *which* artifact, and a reviewer facing
 * a queue of proposals has a fair question -- who wrote this, and have its
 * proposals been good before?
 *
 * PlaywrightGen is in the rare position of being both the MCP server and the
 * place the evidence lives, so it can record the answer instead of guessing at
 * it afterwards.
 *
 * What it records is only what the caller said about itself. That is a claim,
 * not proof: an editor could send any name. It is kept because it is useful for
 * reading history, and it is never used to decide what anyone may do -- the
 * editor token decides that, and a person still approves everything.
 */

/** Clients that introduce themselves, mapped to the name a person would use. */
const KNOWN: Array<{ match: RegExp; name: string }> = [
  { match: /claude[-\s]?code/i, name: "Claude Code" },
  { match: /\bcursor\b/i, name: "Cursor" },
  { match: /windsurf/i, name: "Windsurf" },
  { match: /(visual studio code|vscode|github copilot)/i, name: "VS Code" },
  { match: /jetbrains|intellij|pycharm|webstorm/i, name: "JetBrains" },
  { match: /zed/i, name: "Zed" },
  { match: /cline/i, name: "Cline" },
  { match: /continue\.dev|\bcontinue\b/i, name: "Continue" },
  { match: /claude[-\s]?desktop/i, name: "Claude Desktop" },
];

/** Runtimes that say nothing about the assistant driving them. */
const ANONYMOUS = /^(node|node-fetch|undici|axios|curl|python-requests|httpx|go-http-client|java|okhttp)\b/i;

// Control characters become a space rather than vanishing: deleting them
// silently joins two words together, which is its own small falsehood.
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

/**
 * A readable name for the caller, or null when it did not say anything
 * recognisable. Null is kept as null rather than "unknown", because a record
 * that invents a name is worse than one that admits it does not know.
 *
 * `clientInfo` is what MCP's own handshake carries and is preferred; the
 * User-Agent is the fallback, since this server keeps no session and so cannot
 * remember a handshake from an earlier request.
 */
export function readAgentName(input: {
  userAgent?: string | null;
  clientInfo?: { name?: unknown; version?: unknown } | null;
}): string | null {
  const declared = typeof input.clientInfo?.name === "string" ? clean(input.clientInfo.name) : "";
  const version = typeof input.clientInfo?.version === "string" ? clean(input.clientInfo.version) : "";
  if (declared) {
    const known = KNOWN.find((entry) => entry.match.test(declared));
    const name = known ? known.name : declared.slice(0, 60);
    return version ? `${name} ${version}`.slice(0, 120) : name;
  }

  const agent = clean(input.userAgent ?? "");
  if (!agent) return null;
  const known = KNOWN.find((entry) => entry.match.test(agent));
  if (known) {
    // "which tool, and which version of it" is the question a trail is asked
    // later, so a version in the User-Agent is kept rather than thrown away.
    const stated = /\/(\d[\w.-]*)/.exec(agent)?.[1];
    return stated ? `${known.name} ${stated}`.slice(0, 120) : known.name;
  }
  // A bare HTTP library is the runtime, not the assistant, and naming it would
  // put "node" in the audit trail as though something had been established.
  if (ANONYMOUS.test(agent)) return null;
  return agent.slice(0, 120);
}

/** How a proposal reads on screen when nothing identified itself. */
export const UNNAMED_AGENT = "an editor assistant";
