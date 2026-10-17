/**
 * The rules every piece of generated code is held to, wherever it was made.
 *
 * This product writes code from somebody else's text: a live page it opened,
 * markup pasted into a free tool, a ticket, the output of a failing run. The
 * code is then read by a person judging whether the test is right and run in
 * a pipeline that holds their secrets. The rules below are about the shape of
 * the code rather than the model's good behaviour, because a prompt is a
 * request and a rule is a rule.
 *
 * They lived in the workspace generator alone until 2026-10-17, which had it
 * exactly backwards: the public tool is the one a stranger pastes into, and
 * it carried the weaker set. A rule worth having in one place is worth having
 * in the other, and one copy cannot drift from the other.
 */

export type SafetyFinding = { severity: "BLOCKING" | "WARNING"; code: string; message: string };

/** The address a Playwright configuration says its relative paths are for. */
export function configuredBaseUrlOf(configuration: string): string | null {
  return /baseURL\s*:\s*[^'"`\n]*["'`]([^'"`]+)["'`]/.exec(configuration)?.[1] ?? null;
}

/** Node capabilities a browser test has no business reaching for. */
const NODE_CAPABILITIES = "child_process|fs|net|tls|worker_threads|http|https|dns";

const siteOf = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
};

/**
 * What the code would do that it must not, given the address it is meant to
 * be testing. Without that address the origin checks are skipped rather than
 * guessed at: a rule that fires on everything is turned off within a week.
 */
export function generatedCodeSafetyFindings(code: string, baseUrl?: string | null): SafetyFinding[] {
  const findings: SafetyFinding[] = [];
  const block = (ruleCode: string, message: string) => findings.push({ severity: "BLOCKING", code: ruleCode, message });

  // Static imports, and the two spellings that reach the same modules without
  // one. A rule reading only `import ... from` is satisfied by
  // `await import("node:child_process")`.
  if (
    new RegExp(`from\\s+["'](?:node:)?(?:${NODE_CAPABILITIES})["']`).test(code) ||
    new RegExp(`\\b(?:import|require)\\s*\\(\\s*["'](?:node:)?(?:${NODE_CAPABILITIES})["']\\s*\\)`).test(code)
  ) {
    block("unsafe_node_module", "Generated code imports a disallowed Node.js capability.");
  }

  const ownSite = baseUrl ? siteOf(baseUrl) : null;
  if (ownSite) {
    const requested = [
      ...code.matchAll(/\.(?:get|post|put|patch|delete|fetch|head)\s*\(\s*["'`](https?:\/\/[^"'`]+)["'`]/gi),
    ].map((match) => match[1]);
    const foreign = requested.find((target) => {
      const site = siteOf(target);
      return site !== null && site !== ownSite;
    });
    if (foreign !== undefined) {
      block(
        "request_to_another_site",
        `This sends a request to ${JSON.stringify(foreign)}, which is not the application under test. A test may talk to the application; carrying anything to another address is how data leaves a pipeline.`,
      );
    }
  }

  // Inside the page, where Playwright's fixtures are not involved and one
  // line reaches both the browser's credentials and the network.
  const insidePage = [...code.matchAll(/\.(?:evaluate|evaluateHandle|addInitScript)\s*\(([\s\S]{0,600}?)\)\s*;/g)]
    .map((match) => match[1])
    .join("\n");
  if (/\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/.test(insidePage)) {
    block(
      "network_call_inside_the_page",
      "This runs a network call inside the page, where it is neither recorded as a step nor visible in a trace. Use Playwright's request fixture against the application instead.",
    );
  }

  if (
    /(?:document\.cookie|localStorage|sessionStorage|context\.cookies\s*\(|storageState\s*\(\s*\))[\s\S]{0,200}?\.(?:post|put|send|fetch)\s*\(/i.test(code) ||
    /\.(?:post|put|fetch)\s*\([^)]{0,200}process\.env/i.test(code)
  ) {
    block(
      "sends_credentials_or_storage",
      "This takes cookies, stored state or environment values and sends them somewhere. Nothing a test learns about the session should leave the run.",
    );
  }

  return findings;
}
