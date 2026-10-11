import { describe, expect, it } from "vitest";

import { OrganizationAiRateLimitError } from "@/lib/operations/organization-ai-guard";
import { RequirementDraftingError } from "@/lib/services/requirement-drafting";
import { TicketFetchError } from "@/lib/services/ticket-fetch";
import { ticketReadFeedback } from "@/lib/services/ticket-read-feedback";
import { waitLabel } from "@/lib/wait-label";

/**
 * Found by using the product: a business analyst pasted a ticket, pressed
 * Read the ticket, and got a 500 page saying the workspace "may still be
 * finishing setup" and that "trying again usually works". The workspace was
 * three weeks old and trying again would not work for another 64 minutes.
 */
describe("what a failed ticket read tells the person", () => {
  it("says a daily limit is a limit, and for how long", () => {
    const failure = ticketReadFeedback(new OrganizationAiRateLimitError("organization_daily_limit", 3_836));
    expect(failure).toEqual({ code: "daily_limit", retryAfterSeconds: 3_836 });
    expect(waitLabel(failure!.retryAfterSeconds!)).toBe("1h 4m");
  });

  it("separates too-many-at-once from nothing-left-today", () => {
    // They need opposite things: one waits a minute, the other comes back
    // tomorrow or writes the requirement by hand.
    expect(ticketReadFeedback(new OrganizationAiRateLimitError("organization_burst_limit", 45))).toEqual({
      code: "burst_limit",
      retryAfterSeconds: 45,
    });
    expect(waitLabel(45)).toBe("1 min");
  });

  it("carries every reason reading a ticket can refuse", () => {
    const fetchCodes = [
      "not_a_github_issue",
      "repository_not_connected",
      "issue_not_found",
      "issue_is_a_pull_request",
      "issue_permission_missing",
      "github_unavailable",
    ] as const;
    for (const code of fetchCodes) {
      expect(ticketReadFeedback(new TicketFetchError(code))).toEqual({ code });
    }
    const draftCodes = ["empty_ticket", "not_behaviour", "unavailable"] as const;
    for (const code of draftCodes) {
      expect(ticketReadFeedback(new RequirementDraftingError(code))).toEqual({ code });
    }
  });

  it("leaves a real fault to throw rather than dressing it as advice", () => {
    // A database that is down is not something to tell the analyst to retry.
    expect(ticketReadFeedback(new Error("connection terminated unexpectedly"))).toBeNull();
    expect(ticketReadFeedback("broken")).toBeNull();
  });
});
