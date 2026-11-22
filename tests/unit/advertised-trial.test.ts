import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { OPENING_TRIAL_DAYS, PRO_PLAN } from "@/lib/plan";
import { TRIAL_DAYS } from "@/lib/services/entitlements";

/**
 * The trial a visitor is promised, against the trial the code grants.
 *
 * The pricing page said "7 days free" and a new workspace got fourteen. A
 * third constant, also called TRIAL_DAYS and also 7, was Stripe's
 * subscription trial in the checkout route -- a different trial entirely, and
 * no visitor could know that. Advertising less than is given is the safer
 * direction and still wrong: a team plans an evaluation around the number on
 * the page.
 *
 * Found on 2026-11-21 inside a report a visitor left on 2026-11-07, which had
 * been sitting unread because the notification mail was failing and nothing
 * had ever read the store.
 */
describe("the trial on the pricing page", () => {
  it("is the one a new workspace actually gets", () => {
    expect(PRO_PLAN.trialLabel).toBe(`${OPENING_TRIAL_DAYS} days free`);
    expect(TRIAL_DAYS).toBe(OPENING_TRIAL_DAYS);
  });

  it("is not quoted from a hand-written number", () => {
    // The label used to be the string "7 days free", which is how it drifted
    // from the code in the first place.
    const plan = readFileSync("lib/plan.ts", "utf8");

    expect(plan).toContain("trialLabel: `${OPENING_TRIAL_DAYS} days free`");
    expect(plan).not.toContain('trialLabel: "7 days free"');
  });

  it("keeps Stripe's subscription trial under its own name", () => {
    /*
     * Two trials is fine. Two constants called TRIAL_DAYS, in two files, with
     * two values, one of them quoted at visitors, is how this happened.
     */
    const checkout = readFileSync("app/api/checkout/route.ts", "utf8");

    expect(checkout).toContain("STRIPE_TRIAL_DAYS");
    expect(checkout).not.toMatch(/const TRIAL_DAYS\b/);
  });
});
