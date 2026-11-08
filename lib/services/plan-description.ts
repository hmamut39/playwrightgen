/**
 * The sentence under "Current plan", which has to follow the plan.
 *
 * It branched only on whether a subscription existed, so a workspace on Team
 * without one read "No subscription. Everything in the workspace works; AI
 * use has a smaller daily allowance" -- directly above the larger allowance
 * it had been given. Three claims on one card and two of them wrong.
 *
 * That state was unreachable until a workspace could be granted the Team
 * allowance directly, which is how a trial gets a week that does not stop. A
 * branch nobody could reach is not a branch anybody checked.
 *
 * Pulled out of the page so the decision can be tested. The fault was a
 * ternary reading the wrong thing, which is exactly the shape a test pins and
 * a glance does not.
 */
export function planDescription(input: {
  /**
   * A subscription's status, when there is one. Widened to a string rather
   * than listing the statuses: this decides one sentence, and a new status
   * added to the schema should not stop the page compiling or silently fall
   * into the wrong branch here.
   */
  subscriptionStatus?: string | null;
  hasSubscription: boolean;
  /** Whether the workspace has the Team allowance, however it got it. */
  onTeam: boolean;
  /** What a paid plan costs, for the one case that is paying. */
  priceLabel: string;
  intervalLabel: string;
}): string {
  if (input.subscriptionStatus === "TRIALING") return "Free trial in progress.";
  if (input.hasSubscription) return `${input.priceLabel} ${input.intervalLabel}.`;
  if (input.onTeam) return "The Team allowance, granted to this workspace rather than paid for.";
  return "No subscription. Everything in the workspace works; AI use has a smaller daily allowance.";
}
