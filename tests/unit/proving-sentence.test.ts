import { describe, expect, it } from "vitest";

import { provingSentence } from "@/components/workspace/page-coverage-driver";

/**
 * The line a person watches while their tests are proven.
 *
 * Found on 2026-10-18 by having a mock company prove a four-test plan. The
 * banner said "Proving the tests, two at a time -- each takes about a
 * minute", which predicts about two minutes for four. The run took far
 * longer, and the sentence had no way to say so: someone watching it could
 * not tell slow progress from a stall, because the words never changed.
 *
 * How long one test takes depends on the page, the model and the browser
 * service, so it is not the product's to promise. How many are left is
 * something it already knows -- the workers read that same count to decide
 * whether to keep going -- so the line now reports it instead of guessing.
 */
describe("the sentence shown while tests are being proven", () => {
  it("promises no duration", () => {
    for (const remaining of [null, 0, 1, 4, 12]) {
      expect(provingSentence(remaining), `remaining=${remaining}`).not.toMatch(/minute|second|hour/i);
    }
  });

  it("says how many are left once the server has said", () => {
    expect(provingSentence(4)).toContain("4 tests still to go");
    expect(provingSentence(12)).toContain("12 tests still to go");
  });

  it("counts one test as a test, not as tests", () => {
    expect(provingSentence(1)).toContain("1 test still to go");
    expect(provingSentence(1)).not.toContain("1 tests");
  });

  it("does not claim a count before the first answer comes back", () => {
    // Until a worker has heard from the server, remaining is genuinely
    // unknown; saying "0 still to go" then would be a lie about being nearly
    // finished at the moment the work starts.
    expect(provingSentence(null)).toBe(
      "Proving the tests, two at a time. Keep this page open; if you close it, it carries on from here when you come back.",
    );
  });

  it("does not say 'two at a time' when only one is left to run", () => {
    expect(provingSentence(0)).not.toContain("two at a time");
    expect(provingSentence(0)).toContain("finishing the last one");
  });

  it("always tells the reader the work survives closing the page", () => {
    for (const remaining of [null, 0, 1, 7]) {
      expect(provingSentence(remaining), `remaining=${remaining}`).toContain("carries on from here");
    }
  });
});
