import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * "Proposes, never approves" is a claim about what an editor can reach.
 *
 * The home page says an editor's assistant "Proposes, never approves", and
 * the workspace sells the same boundary: a person reviews everything before
 * it counts. An editor token is handed to an agent that runs unattended in
 * somebody's repository, so the question is not whether the agent is well
 * behaved -- it is whether approving is reachable from there at all.
 *
 * Today it is not, and not by a runtime check: the MCP server imports
 * `createRequirement` and `submitRequirementForReview` and no approval
 * function exists in its module graph. That is the strongest form this
 * guarantee can take, and the kind that an ordinary-looking import would
 * quietly undo.
 *
 * Checked by reading the source because that is exactly the question: a
 * behavioural test could only show that the tools offered today do not
 * approve, not that approving is out of reach.
 */
const root = resolve(__dirname, "..", "..");
const mcp = readFileSync(join(root, "lib/mcp/playwrightgen-mcp.ts"), "utf8");

/** Import lines only, so prose about approval in a tool description is not a hit. */
const imports = mcp
  .split("\n")
  .filter((line) => /^import\b/.test(line.trim()) || /^\s+\w+,?$/.test(line))
  .join("\n");

describe("what an editor token can reach", () => {
  it("imports no function that approves anything", () => {
    for (const forbidden of [
      "approveRequirement",
      "approveTestCase",
      "approveAutomation",
      "approveAutomationArtifact",
      "signEvidence",
    ]) {
      expect(imports, `MCP must not be able to call ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("still reaches the ones that only propose", () => {
    // The boundary is "cannot approve", not "cannot write": removing these
    // would satisfy the test above by making the server useless.
    expect(imports).toContain("createRequirement");
    expect(imports).toContain("submitRequirementForReview");
  });

  it("says so to the agent reading its instructions", () => {
    expect(mcp).toMatch(/propose and send code, but not approve/i);
  });

  it("names the approval functions this test is guarding against", () => {
    // If a service renames its approval function, the list above silently
    // stops guarding anything. This fails when that happens.
    const requirements = readFileSync(join(root, "lib/services/requirements.ts"), "utf8");
    const testCases = readFileSync(join(root, "lib/services/test-cases.ts"), "utf8");
    expect(requirements).toMatch(/export (?:async )?function approveRequirement/);
    expect(testCases).toMatch(/export (?:async )?function approveTestCase/);
  });
});
