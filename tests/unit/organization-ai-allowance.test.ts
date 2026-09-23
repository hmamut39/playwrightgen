import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { readOrganizationAiAllowance } from "@/lib/operations/organization-ai-guard";

const organizationId = randomUUID();
const limits = async () => ({ aiDailyLimit: 20, aiMinuteLimit: 5, plan: "FREE" as const, seats: 1 });

describe("reading what is left of today's AI allowance", () => {
  it("reads the day the reservation counts, and spends nothing", async () => {
    const reads: string[] = [];
    const allowance = await readOrganizationAiAllowance({
      organizationId,
      now: new Date("2026-09-23T11:00:00Z"),
      resolveLimits: limits as never,
      read: async (key) => {
        reads.push(key);
        return "7";
      },
    });

    expect(allowance).toEqual({ dailyLimit: 20, dailyUsed: 7, dailyRemaining: 13 });
    // The same key the reservation script increments, and only a read.
    expect(reads).toEqual([`playwrightgen:organization-ai:${organizationId}:day:2026-09-23`]);
  });

  it("treats an unused day and a broken value as nothing used, and never goes negative", async () => {
    const empty = await readOrganizationAiAllowance({
      organizationId,
      resolveLimits: limits as never,
      read: async () => null,
    });
    expect(empty).toMatchObject({ dailyUsed: 0, dailyRemaining: 20 });

    const nonsense = await readOrganizationAiAllowance({
      organizationId,
      resolveLimits: limits as never,
      read: async () => "not a number",
    });
    expect(nonsense).toMatchObject({ dailyUsed: 0, dailyRemaining: 20 });

    const overspent = await readOrganizationAiAllowance({
      organizationId,
      resolveLimits: limits as never,
      read: async () => 44,
    });
    expect(overspent).toMatchObject({ dailyUsed: 44, dailyRemaining: 0 });
  });
});
