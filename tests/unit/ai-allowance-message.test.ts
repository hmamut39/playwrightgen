import { describe, expect, it } from "vitest";

import { aiAllowanceNotice } from "@/components/workspace/ai-allowance-notice";
import {
  aiAllowanceMessage,
  readAiAllowanceLimit,
} from "@/lib/operations/ai-allowance-message";
import { OrganizationAiRateLimitError } from "@/lib/operations/organization-ai-guard";
import { AutomationArtifactDomainError } from "@/lib/services/automation-artifacts";
import { TestCaseProposalDomainError } from "@/lib/services/test-case-proposals";

/**
 * Found by using the product with a workspace that had spent its allowance:
 * the same fact reached people as a crash page, as "It could not be read just
 * now", as "The model could not be reached" (it was never asked), and as a
 * branch testing a code nothing throws.
 */
describe("what a spent AI allowance tells the person", () => {
  it("reads the guard's own error, with the wait it carries", () => {
    expect(readAiAllowanceLimit(new OrganizationAiRateLimitError("organization_daily_limit", 3_836))).toEqual({
      kind: "daily",
      retryAfterSeconds: 3_836,
    });
    expect(aiAllowanceMessage(new OrganizationAiRateLimitError("organization_daily_limit", 3_836))).toBe(
      "This workspace has used today’s AI requests. They return in 1h 4m, at midnight UTC.",
    );
  });

  it("reads the code a service carried onward, whichever service it was", () => {
    // These are what the pages actually catch: the guard's code wrapped in
    // each service's own error type.
    expect(readAiAllowanceLimit(new TestCaseProposalDomainError("organization_daily_limit", 429))).toEqual({
      kind: "daily",
    });
    expect(readAiAllowanceLimit(new AutomationArtifactDomainError("organization_burst_limit", 429))).toEqual({
      kind: "burst",
    });
  });

  it("tells somebody who can retry to retry, and somebody who cannot not to", () => {
    expect(aiAllowanceMessage(new OrganizationAiRateLimitError("organization_burst_limit", 40))).toContain(
      "works again in 1 min",
    );
    const daily = aiAllowanceMessage(new TestCaseProposalDomainError("organization_daily_limit", 429));
    expect(daily).toContain("midnight UTC");
    // The whole point: no invitation to press the button again today.
    expect(daily).not.toMatch(/try again|again in/i);
  });

  it("says nothing about an allowance when that was not the failure", () => {
    expect(readAiAllowanceLimit(new TestCaseProposalDomainError("requirement_not_approved", 409))).toBeNull();
    expect(aiAllowanceMessage(new Error("socket hang up"))).toBeNull();
    // The code the requirement page used to look for. Nothing throws it, so
    // a page relying on it showed the wrong message every time.
    expect(readAiAllowanceLimit({ code: "organization_ai_rate_limited" })).toBeNull();
  });

  it("carries the wait through the query string a redirect uses", () => {
    expect(aiAllowanceNotice(new OrganizationAiRateLimitError("organization_daily_limit", 600))).toBe("ai-daily:600");
    expect(aiAllowanceNotice(new AutomationArtifactDomainError("organization_burst_limit", 429))).toBe("ai-burst");
    expect(aiAllowanceNotice(new Error("nope"))).toBeNull();
  });
});
