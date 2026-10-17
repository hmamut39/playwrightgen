import "server-only";

import { OrganizationAiRateLimitError } from "@/lib/operations/organization-ai-guard";

/** Longest a caller will be held waiting for the minute window to pass. */
export const BURST_WAIT_CEILING_MS = 65_000;

/**
 * One AI request, waiting out a per-minute limit rather than stopping on it.
 *
 * Several surfaces here spend requests in quick succession for one press of
 * one button: proving a test writes it, runs it and fixes it; generating
 * automation does the same. A free workspace reaches its per-minute limit
 * part-way through, and the work then stopped and asked the person to resume
 * it by hand. A newcomer met that on their first attempt, half a minute after
 * signing up -- the product gave back a job it had been asked to finish.
 *
 * A minute is a wait. The daily allowance is a refusal: it returns at
 * midnight, nobody should sit in front of a page for that, and callers still
 * hear about it immediately. Waiting is attempted once and never for longer
 * than the ceiling, so a mistaken retry-after cannot park a request for an
 * hour.
 */
export async function reserveWaitingOutBurst<T>(
  reserve: () => Promise<T>,
  options: {
    wait?: (ms: number) => Promise<void>;
    ceilingMs?: number;
    /** Told when a wait starts, so a caller can say so if it has somewhere to. */
    onWait?: (ms: number) => void;
  } = {},
): Promise<T> {
  const ceiling = options.ceilingMs ?? BURST_WAIT_CEILING_MS;
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  try {
    return await reserve();
  } catch (error) {
    if (!(error instanceof OrganizationAiRateLimitError)) throw error;
    if (error.code !== "organization_burst_limit") throw error;
    const waitMs = Math.max(1_000, error.retryAfterSeconds * 1_000 + 1_000);
    if (waitMs > ceiling) throw error;
    options.onWait?.(waitMs);
    await wait(waitMs);
    // Once. A second refusal means something other than a passing minute,
    // and holding the work longer only makes the person wait for the same
    // answer.
    return await reserve();
  }
}
