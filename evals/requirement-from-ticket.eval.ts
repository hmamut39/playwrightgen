import { describe, expect, it } from "vitest";

import { requirementFromTicket } from "@/lib/ai/requirement-from-ticket";

/**
 * Measures whether a drafted requirement stays inside its ticket.
 *
 * This prompt makes three promises a reviewer cannot check without the ticket
 * open beside them: it writes only what the ticket supports, it puts what the
 * ticket leaves open into assumptions rather than deciding it, and it refuses
 * a ticket that is not about product behaviour instead of forcing a
 * requirement out of it. All three break silently -- the output stays
 * well-formed and confident either way -- and a broken one puts an invented
 * acceptance criterion into the evidence chain, where everything downstream
 * treats it as something a person asked for.
 *
 * Graded deterministically against the structured output. A judge model would
 * be a second thing that can be wrong, and every property here is directly
 * observable.
 *
 * The cases are deliberately paired. A prompt that answered "behaviour" to
 * everything would pass the first and fail the second; one that invented a
 * ticket key would pass the third and fail the fourth. Scoring only the
 * agreeable half of each pair would measure nothing.
 */

/** Behaviour, with one thing the ticket explicitly does not settle. */
const WITH_AN_OPEN_QUESTION = `SHOP-412: Saved card at checkout

A customer who has paid before should be able to pay again with the card they
saved, without typing the card number. They pick the saved card at the payment
step and enter the security code. The order confirmation shows the last four
digits of the card that was charged.

We have not decided what happens when the saved card has expired.`;

/** Work rather than behaviour: there is nothing here a test could verify. */
const NOT_BEHAVIOUR = `SHOP-501: Upgrade Next.js to the latest release

Our Next.js version is two majors behind and the build warns about it on every
run. Someone should do the upgrade, deal with the breaking changes in the
router, and make sure the pipeline still passes afterwards.`;

/** Behaviour described without any ticket key anywhere in the text. */
const NO_KEY = `A signed-in customer can change the delivery address on an order
that has not yet shipped. The order page offers an edit control beside the
address, and saving it shows the new address on the order.`;

const ready = Boolean(process.env.OPENAI_API_KEY?.trim());

describe.skipIf(!ready)("drafting a requirement from a ticket", () => {
  it("keeps the detail the ticket gave", async () => {
    const result = await requirementFromTicket({ ticket: WITH_AN_OPEN_QUESTION });

    expect(result.isBehaviour).toBe(true);
    expect(result.acceptanceCriteria.length).toBeGreaterThan(0);

    // The ticket names two observable things. A requirement that loses them
    // has dropped what a test would actually check.
    const stated = [result.description, ...result.acceptanceCriteria].join(" ").toLowerCase();
    expect(stated, "the ticket's observable outcome is missing").toMatch(/last four|last 4/);
    expect(stated, "the security code step is missing").toMatch(/security code|cvc|cvv/);
  }, 120_000);

  it("raises what the ticket left open instead of deciding it", async () => {
    const result = await requirementFromTicket({ ticket: WITH_AN_OPEN_QUESTION });

    // Asserted on the criteria alone, which is where an invented rule becomes
    // a testable claim and enters the evidence chain as something a person
    // asked for.
    //
    // The prompt's wording is stricter -- open questions belong "never in the
    // description or the acceptance criteria" -- and an earlier version of
    // this case held the description to that too. Four runs on 2026-10-11 said
    // the strictness was in the wrong place: expiry reached the description
    // once, and the sentence was the ticket's own, "We have not decided what
    // happens when the saved card has expired." Repeating that decides
    // nothing. Over the same four runs no acceptance criterion mentioned
    // expiry at all. So the criteria are held strictly and the description is
    // not, because mentioning an open question is not the same as settling it.
    for (const criterion of result.acceptanceCriteria) {
      expect(criterion.toLowerCase(), "an acceptance criterion decides what the ticket did not").not.toMatch(/expir/);
    }
    expect(
      result.assumptions.some((line) => /expir/i.test(line)),
      `the open question was dropped rather than raised: ${result.assumptions.join(" | ") || "(no assumptions)"}`,
    ).toBe(true);
  }, 120_000);

  it("refuses a ticket that is not about behaviour", async () => {
    const result = await requirementFromTicket({ ticket: NOT_BEHAVIOUR });

    // The half of the pair that can fail. A prompt that drifted into forcing a
    // requirement out of anything would pass every check above and fail here,
    // and nothing else in the system would notice: the drafted requirement
    // would look exactly like a real one.
    expect(result.isBehaviour, "called a dependency upgrade product behaviour").toBe(false);
    expect(result.notBehaviourReason.trim().length, "refused without saying why").toBeGreaterThan(0);
    expect(
      result.acceptanceCriteria,
      "invented acceptance criteria for a ticket it had just refused",
    ).toEqual([]);
  }, 120_000);

  it("takes a ticket key from the text", async () => {
    const result = await requirementFromTicket({ ticket: WITH_AN_OPEN_QUESTION });

    // Traceability back to where the requirement came from. The key is in the
    // first line; losing it costs the link.
    expect(result.externalReference).toContain("SHOP-412");
  }, 120_000);

  it("does not invent a ticket key when the text has none", async () => {
    const result = await requirementFromTicket({ ticket: NO_KEY });

    // The paired half. A reference the ticket never contained points at
    // nothing, and points at it confidently.
    expect(result.isBehaviour).toBe(true);
    expect(
      result.externalReference.trim(),
      `invented a reference: ${result.externalReference}`,
    ).toBe("");
  }, 120_000);
});
