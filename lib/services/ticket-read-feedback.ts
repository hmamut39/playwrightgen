import { readAiAllowanceLimit } from "@/lib/operations/ai-allowance-message";
import { RequirementDraftingError } from "@/lib/services/requirement-drafting";
import { TicketFetchError } from "@/lib/services/ticket-fetch";

/**
 * What to tell somebody whose ticket could not be read.
 *
 * Reading a ticket can fail for a reason the person can act on — the wrong
 * address, a repository nobody connected — and those were already said. It
 * can also fail because the workspace has used its AI requests for the day,
 * and that one reached the browser as a crash: a 500 page reading "This page
 * didn't load. If you just created your workspace, it may still be finishing
 * setup. Trying again usually works." Nothing was finishing setup and trying
 * again would not work for another hour, which the product knew to the second
 * and did not say.
 *
 * Every failure a person can be told about is named here, so a new one is a
 * line in this list rather than a crash page. Anything not named is a real
 * fault and is left to throw.
 */
export type TicketReadFeedback = {
  /** The code carried back to the form, which chooses the sentence. */
  code: string;
  /** Seconds until it will work, when the failure is a limit. */
  retryAfterSeconds?: number;
};

export function ticketReadFeedback(error: unknown): TicketReadFeedback | null {
  const allowance = readAiAllowanceLimit(error);
  if (allowance) {
    return {
      code: allowance.kind === "burst" ? "burst_limit" : "daily_limit",
      ...(allowance.retryAfterSeconds ? { retryAfterSeconds: allowance.retryAfterSeconds } : {}),
    };
  }
  if (error instanceof TicketFetchError) return { code: error.code };
  if (error instanceof RequirementDraftingError) return { code: error.code };
  return null;
}
