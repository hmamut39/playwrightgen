import { describe, expect, it, vi } from "vitest";

import { OrganizationAiRateLimitError } from "@/lib/operations/organization-ai-guard";
import { reserveWaitingOutBurst } from "@/lib/operations/reserve-waiting";

/**
 * Found by signing up as a new account and pressing the first button the
 * product offers. Proving one test spends several requests in a row -- write
 * it, run it, fix it -- so a free workspace reaches its per-minute limit
 * part-way through, and the run stopped and asked the newcomer to press
 * "Carry on". Half a minute after signing up, the product handed back a job
 * it had been asked to finish.
 */
const burst = (seconds = 42) => new OrganizationAiRateLimitError("organization_burst_limit", seconds);
const daily = () => new OrganizationAiRateLimitError("organization_daily_limit", 3_600);

describe("one AI request, through a minute limit", () => {
  it("waits the minute out and carries on by itself", async () => {
    const waits: number[] = [];
    const reserve = vi
      .fn()
      .mockRejectedValueOnce(burst(42))
      .mockResolvedValueOnce({ dailyRemaining: 11 });

    const result = await reserveWaitingOutBurst(reserve, { wait: async (ms) => { waits.push(ms); } });

    expect(result).toEqual({ dailyRemaining: 11 });
    expect(reserve).toHaveBeenCalledTimes(2);
    // The window it was told to wait, plus a second so the retry lands after
    // it rather than exactly on it.
    expect(waits).toEqual([43_000]);
  });

  it("does not wait out a daily allowance, which returns at midnight", async () => {
    // Nobody sits in front of a page for seven hours, and pretending to try
    // would be worse than saying so.
    const reserve = vi.fn().mockRejectedValue(daily());
    const wait = vi.fn();

    await expect(reserveWaitingOutBurst(reserve, { wait })).rejects.toMatchObject({
      code: "organization_daily_limit",
    });
    expect(wait).not.toHaveBeenCalled();
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it("gives up rather than parking the work for an implausible wait", async () => {
    // A retry-after longer than a minute is not a minute limit behaving
    // normally, and holding somebody's run on that figure is how a page sits
    // there saying "proving" for an hour.
    const reserve = vi.fn().mockRejectedValue(burst(600));
    const wait = vi.fn();

    await expect(reserveWaitingOutBurst(reserve, { wait })).rejects.toMatchObject({
      code: "organization_burst_limit",
    });
    expect(wait).not.toHaveBeenCalled();
  });

  it("waits once, because a second refusal is not a passing minute", async () => {
    const reserve = vi.fn().mockRejectedValue(burst(5));

    await expect(
      reserveWaitingOutBurst(reserve, { wait: async () => {} }),
    ).rejects.toBeInstanceOf(OrganizationAiRateLimitError);
    expect(reserve).toHaveBeenCalledTimes(2);
  });

  it("passes anything else straight through", async () => {
    const reserve = vi.fn().mockRejectedValue(new Error("redis is unreachable"));

    await expect(reserveWaitingOutBurst(reserve, { wait: async () => {} })).rejects.toThrow("redis is unreachable");
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it("says when it starts waiting, for a caller with somewhere to show it", async () => {
    const onWait = vi.fn();
    const reserve = vi.fn().mockRejectedValueOnce(burst(10)).mockResolvedValueOnce("ok");

    await reserveWaitingOutBurst(reserve, { wait: async () => {}, onWait });

    expect(onWait).toHaveBeenCalledWith(11_000);
  });
});
