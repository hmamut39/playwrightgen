import { describe, expect, it } from "vitest";

import { planDescription } from "@/lib/services/plan-description";

/**
 * The sentence under "Current plan".
 *
 * It branched only on whether a subscription existed, so a workspace on Team
 * without one read "No subscription ... AI use has a smaller daily allowance"
 * directly above the larger allowance it had been given. That state was
 * unreachable until a workspace could be granted the Team allowance
 * directly -- which is how a trial company gets a week that does not stop on
 * day one -- and a branch nobody could reach is not a branch anybody checked.
 */
const base = { priceLabel: "$19", intervalLabel: "per workspace, per month" };

describe("what the billing card says about the plan", () => {
  it("does not call a granted Team allowance a smaller one", () => {
    const said = planDescription({ ...base, hasSubscription: false, onTeam: true });

    expect(said).toBe("The Team allowance, granted to this workspace rather than paid for.");
    // The exact contradiction: a smaller allowance claimed above a larger one.
    expect(said).not.toContain("smaller");
    // And it must not imply they are paying, because they are not.
    expect(said).not.toContain("$19");
  });

  it("still says what a free workspace has", () => {
    expect(planDescription({ ...base, hasSubscription: false, onTeam: false })).toContain(
      "smaller daily allowance",
    );
  });

  it("names the price when somebody is actually paying", () => {
    expect(
      planDescription({ ...base, hasSubscription: true, subscriptionStatus: "ACTIVE", onTeam: true }),
    ).toBe("$19 per workspace, per month.");
  });

  it("puts a Stripe trial ahead of everything else", () => {
    // A trialling subscription is Team and unpaid at once; the subscription
    // is the truer thing to say, because it becomes a charge.
    expect(
      planDescription({ ...base, hasSubscription: true, subscriptionStatus: "TRIALING", onTeam: true }),
    ).toBe("Free trial in progress.");
  });
});

describe("a workspace on its opening allowance", () => {
  const base = {
    hasSubscription: false,
    onTeam: true,
    priceLabel: "$19",
    intervalLabel: "a month",
  };

  it("does not imply somebody decided something about them", () => {
    // "Granted to this workspace rather than paid for" is what the sentence
    // says when the owner has raised one workspace by hand. Every brand-new
    // workspace would have read it, and invited the reader to wonder who.
    const said = planDescription({ ...base, trialEndsAt: new Date("2026-11-28T00:00:00.000Z") });

    expect(said).toBe("Every new workspace starts with the Team allowance. This one still has it.");
    expect(said).not.toContain("granted to this workspace");
  });

  it("keeps the granted wording for one that really was granted", () => {
    const said = planDescription({ ...base, trialEndsAt: null });

    expect(said).toContain("granted to this workspace rather than paid for");
  });

  it("says the price when they pay, trial or not", () => {
    // Subscribing inside the first fortnight is paying, and being told about
    // an allowance that ends would read as a countdown they had just removed.
    const said = planDescription({
      ...base,
      hasSubscription: true,
      trialEndsAt: new Date("2026-11-28T00:00:00.000Z"),
    });

    expect(said).toBe("$19 a month.");
  });
});
