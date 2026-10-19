import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every place that tells somebody an AI step failed has to know about credit.
 *
 * On 2026-10-19 the AI account ran out and four surfaces said the wrong
 * thing. The free tools told a visitor to try again. "Cover a page" told a
 * brand-new workspace "A plan could not be made for this page. Try again, or
 * say what you want covered" -- blaming a request that was fine, at the first
 * thing that workspace ever did. Its driver retried the call in a loop.
 *
 * Only the distinction is unit-testable in isolation (see
 * provider-out-of-credit.test.ts); whether each surface asks is a question
 * about wiring, and wiring is what was missing. This lists the user-facing
 * paths and insists each one asks before it advises.
 *
 * A new AI surface that offers a retry belongs in this list.
 */
const root = resolve(__dirname, "..", "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

const SURFACES = [
  "app/api/quick-generate/route.ts",
  "app/api/coverage-review/route.ts",
  "app/api/page-coverage/advance/route.ts",
  "lib/services/page-coverage.ts",
];

describe("what a person is told when the AI account is empty", () => {
  for (const surface of SURFACES) {
    it(`${surface} asks before it advises`, () => {
      expect(read(surface)).toContain("isProviderOutOfCredit");
    });
  }

  it("the page-coverage driver stops instead of retrying", () => {
    // A 5xx is retried by design; this is the one that must not be.
    const driver = read("components/workspace/page-coverage-driver.tsx");
    expect(driver).toContain("data.retryable === false");
  });

  it("the operational log has somewhere to put the reason", () => {
    // The gap that made this invisible: the telemetry schema is an allowlist
    // and had no field for why anything failed.
    expect(read("lib/operations/safe-telemetry.ts")).toMatch(/reason: z\.string\(\)\.max\(\d+\)\.optional\(\)/);
  });

  it("never tells someone their request was the problem when it was not", () => {
    // The specific sentence that sent a new team away rewording a request
    // that was never at fault must not be the only thing that path can say.
    const coverage = read("lib/services/page-coverage.ts");
    const blameIndex = coverage.indexOf("Try again, or say what you want covered");
    expect(blameIndex).toBeGreaterThan(-1);
    const guardIndex = coverage.indexOf("isProviderOutOfCredit");
    expect(guardIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(blameIndex);
  });
});
