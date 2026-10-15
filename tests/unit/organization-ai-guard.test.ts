import { describe, expect, it, vi } from "vitest";

import {
  readOrganizationAiAllowance,
  reserveOrganizationAiRequest,
} from "@/lib/operations/organization-ai-guard";

const organizationId = "11111111-1111-4111-8111-111111111111";
const source = {
  UPSTASH_REDIS_REST_URL: "https://redis.example",
  UPSTASH_REDIS_REST_TOKEN: "redis-test-token-that-is-long-enough",
};

describe("organization AI guard", () => {
  it("reserves organization quota before a provider call", async () => {
    const execute = vi.fn().mockResolvedValue([1, 1, 7, 0]);
    const result = await reserveOrganizationAiRequest({
      organizationId,
      surface: "requirement-review",
      source,
      now: new Date("2026-08-31T12:34:00.000Z"),
      execute,
    });

    expect(execute).toHaveBeenCalledWith(
      [
        `playwrightgen:organization-ai:${organizationId}:minute`,
        `playwrightgen:organization-ai:${organizationId}:day:2026-08-31`,
        // The tally of what spent it, counted in the same script as the
        // spend, so the breakdown cannot disagree with the total.
        `playwrightgen:organization-ai:${organizationId}:surfaces:2026-08-31`,
      ],
      ["4", "20", "60", "41160", "requirement-review"],
    );
    expect(result).toMatchObject({ dailyRemaining: 13, minuteRemaining: 3 });
  });

  it("answers what today's requests were spent on, largest first", async () => {
    // A workspace told "today's AI requests are used" could not find out what
    // had used them.
    const allowance = await readOrganizationAiAllowance({
      organizationId,
      source,
      now: new Date("2026-08-31T12:34:00.000Z"),
      read: async () => 9,
      readSurfaces: async (key) => {
        expect(key).toBe(`playwrightgen:organization-ai:${organizationId}:surfaces:2026-08-31`);
        return { "page-coverage": 6, "requirement-review": "2", "automation-repair": 0, "free-tools": 1 };
      },
    });

    expect(allowance.dailyUsed).toBe(9);
    expect(allowance.bySurface).toEqual([
      { surface: "page-coverage", used: 6 },
      { surface: "requirement-review", used: 2 },
      { surface: "free-tools", used: 1 },
    ]);
  });

  it("still reports the allowance when the tally cannot be read", async () => {
    // The number that is enforced is the total. A breakdown that fails must
    // not take the figure beside it down as well.
    const allowance = await readOrganizationAiAllowance({
      organizationId,
      source,
      read: async () => 4,
      readSurfaces: async () => {
        throw new Error("redis is unreachable");
      },
    });

    expect(allowance.dailyUsed).toBe(4);
    expect(allowance.bySurface).toEqual([]);
  });

  it("rejects an exhausted daily organization budget", async () => {
    await expect(
      reserveOrganizationAiRequest({
        organizationId,
        surface: "automation-generation",
        source,
        execute: vi.fn().mockResolvedValue([0, 2, 20, 2]),
      }),
    ).rejects.toMatchObject({ code: "organization_daily_limit" });
  });
});
