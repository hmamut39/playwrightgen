import { describe, expect, it } from "vitest";

import { isProviderOutOfCredit, providerFailureReason } from "@/lib/ai/provider-availability";

/**
 * Telling an exhausted AI account apart from a busy one.
 *
 * Found on 2026-10-19 by timing the home page's own promise. Quick Generate
 * answered HTTP 500 "Quick Generate failed. Please try again." The provider
 * had said `429 You have no credits remaining. Add credits to continue using
 * the API.` Nothing logged that sentence and nothing showed it, so the first
 * thing a stranger tries was broken, the message invited them to try again,
 * and the only person able to fix it had no way to find out.
 *
 * Both cases arrive as 429 and mean opposite things, so the distinction has
 * to be exact: a rate limit is a pause and must keep being retried, while an
 * empty account is a wall. Reading one as the other would either spin
 * forever or tell people the product is down when it is merely busy.
 */
const openAiError = (status: number, message: string, code?: string) =>
  Object.assign(new Error(message), { status, ...(code ? { error: { code } } : {}) });

describe("recognising an AI account that has run out", () => {
  it("recognises the message production actually returned", () => {
    expect(
      isProviderOutOfCredit(
        openAiError(
          429,
          "429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",
        ),
      ),
    ).toBe(true);
  });

  it("recognises the provider's own code for it", () => {
    expect(isProviderOutOfCredit(openAiError(429, "Quota exceeded", "insufficient_quota"))).toBe(true);
    expect(isProviderOutOfCredit(openAiError(429, "Limit", "billing_hard_limit_reached"))).toBe(true);
  });

  it("does not mistake an ordinary rate limit for an empty account", () => {
    // The one that must keep working as before: this is a pause, and waiting
    // is the right answer. Calling it "out of credit" would take a product
    // that was merely busy and tell everyone it was unavailable.
    expect(
      isProviderOutOfCredit(
        openAiError(429, "Rate limit reached for gpt-5 in organization org-x on requests per min (RPM): Limit 500"),
      ),
    ).toBe(false);
  });

  it("ignores failures that are not about money at all", () => {
    expect(isProviderOutOfCredit(openAiError(500, "The server had an error"))).toBe(false);
    expect(isProviderOutOfCredit(openAiError(401, "Incorrect API key provided"))).toBe(false);
    expect(isProviderOutOfCredit(new Error("socket hang up"))).toBe(false);
    expect(isProviderOutOfCredit(null)).toBe(false);
    expect(isProviderOutOfCredit(undefined)).toBe(false);
  });

  it("never writes a key into the log line", () => {
    const reason = providerFailureReason(
      new Error("401 Incorrect API key provided: sk-proj-abcdef1234567890. Authorization: Bearer sk-proj-abcdef1234567890"),
    );
    expect(reason).not.toContain("abcdef1234567890");
    expect(reason).toContain("sk-***");
    expect(reason).toContain("Bearer ***");
  });

  it("keeps the reason short enough to be a log line", () => {
    expect(providerFailureReason(new Error("x".repeat(5_000))).length).toBeLessThanOrEqual(300);
    // And collapses the newlines a stack trace would otherwise smuggle in.
    expect(providerFailureReason(new Error("first\n   second"))).toBe("first second");
  });
});
