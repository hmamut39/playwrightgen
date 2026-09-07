import { describe, expect, it } from "vitest";

import { proposeTestCases, type TestCaseProposalInput } from "@/lib/ai/test-case-proposals";

/**
 * Measures whether proposed Test Cases stay inside the requirement.
 *
 * The panel makes two claims a reader has no way to check for themselves: that
 * the model has not seen the application and will not invent URLs, selectors or
 * credentials, and that anything the requirement leaves undecided comes back as
 * a question rather than a guess. Both are exactly the kind of promise a prompt
 * change breaks silently, because the output stays well-formed and confident
 * either way.
 *
 * Graded deterministically. A judge model would be a second thing that can be
 * wrong, and these properties are all directly observable in the structured
 * output.
 */

const baseInput: TestCaseProposalInput = {
  title: "Customers can pay by card",
  description:
    "A signed-in customer can pay for their cart with a valid card and receive an order confirmation.",
  acceptanceCriteria:
    "A valid card produces an order confirmation showing the order number.",
  externalReference: "",
  existingTestCaseTitles: [],
  guidance: "",
};

/** Text that could only come from the model imagining an implementation. */
const INVENTED = [
  /https?:\/\//i,
  /\bdata-testid\b/i,
  /\bcss=|\bxpath=|\bquerySelector\b/i,
  /#[a-z][\w-]{3,}\s*(?:>|\{)/i,
  /\b4111\s?1111\s?1111\s?1111\b/,
  /\bpassword\s*[:=]\s*\S+/i,
];

function proposalText(proposal: {
  title: string;
  objective: string;
  preconditions: string;
  steps: string[];
  expectedResults: string[];
  rationale: string;
}) {
  return [
    proposal.title,
    proposal.objective,
    proposal.preconditions,
    ...proposal.steps,
    ...proposal.expectedResults,
    proposal.rationale,
  ].join("\n");
}

describe("Test Case proposal quality", () => {
  it("proposes coverage without inventing an implementation", async () => {
    const result = await proposeTestCases(baseInput);

    expect(result.proposals.length).toBeGreaterThan(0);
    for (const proposal of result.proposals) {
      const text = proposalText(proposal);
      for (const pattern of INVENTED) {
        expect(
          pattern.test(text),
          `"${proposal.title}" contains ${pattern} which the model could not know`,
        ).toBe(false);
      }
      // Every proposal must be checkable by a person: steps to take and
      // outcomes to observe.
      expect(proposal.steps.length).toBeGreaterThan(0);
      expect(proposal.expectedResults.length).toBeGreaterThan(0);
      expect(proposal.rationale.trim().length).toBeGreaterThan(0);
    }
  }, 120_000);

  it("covers the straightforward path before anything else", async () => {
    // A set of proposals that tests only edge cases leaves the behaviour the
    // requirement actually describes unverified.
    const result = await proposeTestCases(baseInput);

    expect(result.proposals.some((proposal) => proposal.coverage === "HAPPY_PATH")).toBe(true);
  }, 120_000);

  it("asks about what the requirement does not settle", async () => {
    // Deliberately vague: no card brands, no amount limits, no failure
    // behaviour. Silence here would mean those gaps were resolved by guessing
    // inside a proposal instead of raised for a person to decide.
    const result = await proposeTestCases({
      ...baseInput,
      description: "Customers can pay for their cart.",
      acceptanceCriteria: "Payment works.",
    });

    expect(result.openQuestions.length).toBeGreaterThan(0);
  }, 120_000);

  it("does not repeat coverage that already exists", async () => {
    const existing = "Signed-in customer pays with a valid card and receives an order confirmation";
    const result = await proposeTestCases({
      ...baseInput,
      existingTestCaseTitles: [existing],
    });

    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    for (const proposal of result.proposals) {
      expect(normalize(proposal.title)).not.toBe(normalize(existing));
    }
  }, 120_000);

  it("keeps proposals to a reviewable number", async () => {
    // Padding the list is the cheapest way to look thorough and the fastest way
    // to make a reviewer stop reading.
    const result = await proposeTestCases(baseInput);

    expect(result.proposals.length).toBeLessThanOrEqual(8);
  }, 120_000);
});
