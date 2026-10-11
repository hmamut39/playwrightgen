import { describe, expect, it } from "vitest";

import { readCriteriaCoverage } from "@/lib/ai/criteria-coverage";

/**
 * Measures whether the coverage reading credits only what the tests show.
 *
 * The prompt names its own harm: "a criterion wrongly called covered is the
 * one nobody will ever write a test for." A gap reported as covered does not
 * merely mislead, it removes the reason anybody would look again, and the
 * reading is shown to a person precisely when they are deciding what is
 * missing.
 *
 * The failure mode worth testing is specific and is the one the prompt warns
 * about: crediting a criterion to a test because the two use similar words
 * while describing different behaviour. So the tests below are deliberately
 * written to bait that. One checks the security code is *required*; a
 * criterion says the order confirmation shows the last four digits. They share
 * the vocabulary of cards and payment and check nothing of each other.
 *
 * Graded deterministically against the structured output. A judge model would
 * be a second thing that can be wrong, and every property here is observable.
 */

const REQUIREMENT_TITLE = "A returning customer can pay with a saved card";

const CRITERIA = [
  "A saved card is offered at the payment step to a customer who has paid before",
  "The order confirmation shows the last four digits of the card that was charged",
  "A refund issued against that order returns the money to the same saved card",
];

/**
 * Covers the first criterion and nothing else. The second test shares the
 * vocabulary of the second criterion without checking it, and the third shows
 * behaviour the requirement never mentions.
 */
const TESTS = [
  {
    title: "A saved card is offered at the payment step",
    objective: "A customer who has paid before sees their saved card as an option.",
    steps: ["Sign in as a customer with a previous order", "Open the payment step"],
    expectedResults: ["The saved card is listed as a payment option"],
  },
  {
    title: "The security code is required before paying with a saved card",
    objective: "Paying with a saved card cannot be completed without the security code.",
    steps: ["Choose the saved card", "Leave the security code empty", "Submit"],
    expectedResults: ["The order is not placed", "A message asks for the security code"],
  },
  {
    title: "A guest can check out without creating an account",
    objective: "Checkout completes for a visitor who never signs in.",
    steps: ["Add an item to the cart as a visitor", "Complete checkout"],
    expectedResults: ["The order is confirmed without an account being created"],
  },
];

const ready = Boolean(process.env.OPENAI_API_KEY?.trim());

const forCriterion = (
  result: Awaited<ReturnType<typeof readCriteriaCoverage>>,
  fragment: string,
) => result.criteria.find((entry) => entry.criterion.toLowerCase().includes(fragment));

describe.skipIf(!ready)("reading which criteria the tests cover", () => {
  it("credits a criterion a test actually checks", async () => {
    const result = await readCriteriaCoverage({
      requirementTitle: REQUIREMENT_TITLE,
      acceptanceCriteria: CRITERIA,
      tests: TESTS,
    });

    const offered = forCriterion(result, "saved card is offered");
    expect(offered, "the first criterion is missing from the reading").toBeDefined();
    expect(offered?.covered, "a criterion a test plainly checks was called uncovered").toBe(true);
    // Naming the test is what makes the claim checkable by a person.
    expect(offered?.coveredBy.join(" ")).toMatch(/saved card is offered/i);
  }, 120_000);

  it("does not credit a criterion to a test that only shares its words", async () => {
    const result = await readCriteriaCoverage({
      requirementTitle: REQUIREMENT_TITLE,
      acceptanceCriteria: CRITERIA,
      tests: TESTS,
    });

    // The bait. Nothing in the three tests looks at the order confirmation or
    // at any digits, but one of them is all about cards and security codes.
    const confirmation = forCriterion(result, "last four digits");
    expect(confirmation, "the second criterion is missing from the reading").toBeDefined();
    expect(
      confirmation?.covered,
      `credited to: ${confirmation?.coveredBy.join(", ") || "(nothing)"} -- ${confirmation?.reason}`,
    ).toBe(false);
    // The schema says so too, and a populated list beside covered:false would
    // read on the page as though something checked it.
    expect(confirmation?.coveredBy).toEqual([]);
  }, 120_000);

  it("says a criterion nothing comes near is uncovered", async () => {
    const result = await readCriteriaCoverage({
      requirementTitle: REQUIREMENT_TITLE,
      acceptanceCriteria: CRITERIA,
      tests: TESTS,
    });

    const refund = forCriterion(result, "refund");
    expect(refund, "the third criterion is missing from the reading").toBeDefined();
    expect(refund?.covered, `credited to: ${refund?.coveredBy.join(", ")}`).toBe(false);
    // The reason is the only part a reviewer can check against the two lists.
    expect(refund?.reason.trim().length).toBeGreaterThan(0);
  }, 120_000);

  it("returns every criterion, in the order it was given", async () => {
    const result = await readCriteriaCoverage({
      requirementTitle: REQUIREMENT_TITLE,
      acceptanceCriteria: CRITERIA,
      tests: TESTS,
    });

    // A reading that silently drops a criterion reports a smaller gap than
    // there is, which is the same overstatement as calling one covered.
    expect(result.criteria).toHaveLength(CRITERIA.length);
    expect(result.criteria.map((entry) => entry.criterion)).toEqual(CRITERIA);
  }, 120_000);

  it("names behaviour the tests check that the requirement never states", async () => {
    const result = await readCriteriaCoverage({
      requirementTitle: REQUIREMENT_TITLE,
      acceptanceCriteria: CRITERIA,
      tests: TESTS,
    });

    // Guest checkout is in the tests and nowhere in the requirement. This is
    // how a team learns their story left something out.
    expect(
      result.notInTheRequirement.join(" ").toLowerCase(),
      `nothing reported: ${JSON.stringify(result.notInTheRequirement)}`,
    ).toMatch(/guest|without .*account|not signed in/);
  }, 120_000);

  it("reports nothing extra when the tests stay inside the requirement", async () => {
    // The paired half. A prompt that always finds something outside the
    // requirement would pass the case above and fail this one.
    //
    // The fixture is its own test rather than TESTS[0], which was the first
    // attempt and was wrong: that test signs in, the requirement never
    // mentions signing in, and the reading correctly reported it as behaviour
    // the story left out. The eval caught a bad fixture rather than a bad
    // prompt. This one stays strictly inside the criterion, so anything
    // reported here really would be invented.
    const result = await readCriteriaCoverage({
      requirementTitle: REQUIREMENT_TITLE,
      acceptanceCriteria: [CRITERIA[0]],
      tests: [
        {
          title: "A saved card is offered at the payment step",
          objective: "A customer who has paid before sees their saved card as an option.",
          steps: ["Open the payment step as a customer who has paid before"],
          expectedResults: ["The saved card is listed as a payment option"],
        },
      ],
    });

    expect(
      result.notInTheRequirement,
      `invented: ${JSON.stringify(result.notInTheRequirement)}`,
    ).toEqual([]);
  }, 120_000);
});
