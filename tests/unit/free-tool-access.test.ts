import { describe, expect, it } from "vitest";

import {
  FreeToolLimitError,
  freeToolLimitBody,
  reserveFreeToolRun,
} from "@/lib/operations/free-tool-access";
import { OrganizationAiRateLimitError } from "@/lib/operations/organization-ai-guard";
import { PublicAiRateLimitError } from "@/lib/operations/public-ai-guard";

const request = new Request("https://playwrightgen.test/api/quick-generate", { method: "POST" });
const input = { request, surface: "quick-generate" as const, requestId: "req-1" };

function deps(overrides: {
  identity?: { userId: string | null; orgId: string | null };
  team?: string | null | Error;
  teamRemaining?: number | Error;
  publicRemaining?: number | Error;
}) {
  const calls: string[] = [];
  return {
    calls,
    dependencies: {
      identify: async () => overrides.identity ?? { userId: null, orgId: null },
      findTeamOrganization: async () => {
        if (overrides.team instanceof Error) throw overrides.team;
        return overrides.team ?? null;
      },
      reserveTeam: async () => {
        calls.push("team");
        if (overrides.teamRemaining instanceof Error) throw overrides.teamRemaining;
        return overrides.teamRemaining ?? 59;
      },
      reservePublic: async () => {
        calls.push("public");
        if (overrides.publicRemaining instanceof Error) throw overrides.publicRemaining;
        return overrides.publicRemaining ?? 4;
      },
    },
  };
}

describe("who pays for a free-tool run", () => {
  it("counts a visitor against the five-a-day limit", async () => {
    const { calls, dependencies } = deps({});
    await expect(reserveFreeToolRun(input, dependencies)).resolves.toEqual({ plan: "PUBLIC", remaining: 4, userId: null });
    expect(calls).toEqual(["public"]);
  });

  it("counts a signed-in person on the free plan the same way", async () => {
    const { calls, dependencies } = deps({ identity: { userId: "user_1", orgId: "org_1" }, team: null });
    await expect(reserveFreeToolRun(input, dependencies)).resolves.toMatchObject({ plan: "PUBLIC", userId: "user_1" });
    expect(calls).toEqual(["public"]);
  });

  it("lets a Team customer use their workspace's allowance instead", async () => {
    const { calls, dependencies } = deps({
      identity: { userId: "user_1", orgId: "org_1" },
      team: "3b6c7a52-3b4e-4c65-8a35-1a2b3c4d5e6f",
      teamRemaining: 42,
    });
    await expect(reserveFreeToolRun(input, dependencies)).resolves.toEqual({ plan: "TEAM", remaining: 42, userId: "user_1" });
    expect(calls).toEqual(["team"]);
  });

  it("never grants the paid allowance because a lookup failed", async () => {
    const { calls, dependencies } = deps({
      identity: { userId: "user_1", orgId: "org_1" },
      team: new Error("database unavailable"),
    });
    await expect(reserveFreeToolRun(input, dependencies)).resolves.toMatchObject({ plan: "PUBLIC" });
    expect(calls).toEqual(["public"]);
  });

  it("offers the Team plan when a visitor's five runs are used up", async () => {
    const { dependencies } = deps({ publicRemaining: new PublicAiRateLimitError("daily_limit", 3600, "req-1", 0) });
    const error = await reserveFreeToolRun(input, dependencies).catch((caught) => caught);
    expect(error).toBeInstanceOf(FreeToolLimitError);
    expect(freeToolLimitBody(error)).toMatchObject({
      code: "daily_limit",
      plan: "PUBLIC",
      upgrade: true,
      retryAfterSeconds: 3600,
    });
  });

  it("does not offer an upgrade to someone who already pays", async () => {
    const { dependencies } = deps({
      identity: { userId: "user_1", orgId: "org_1" },
      team: "3b6c7a52-3b4e-4c65-8a35-1a2b3c4d5e6f",
      teamRemaining: new OrganizationAiRateLimitError("organization_daily_limit", 7200, 0),
    });
    const error = await reserveFreeToolRun(input, dependencies).catch((caught) => caught);
    expect(freeToolLimitBody(error)).toMatchObject({ plan: "TEAM", code: "daily_limit", upgrade: false });
  });

  it("does not offer an upgrade for a one-minute burst limit", async () => {
    const { dependencies } = deps({ publicRemaining: new PublicAiRateLimitError("burst_limit", 60, "req-1", 3) });
    const error = await reserveFreeToolRun(input, dependencies).catch((caught) => caught);
    expect(freeToolLimitBody(error)).toMatchObject({ code: "burst_limit", upgrade: false });
  });

  it("does not tell somebody their day is spent because they clicked twice", async () => {
    /*
     * The fault this guards, found by using the free generator on production
     * as a stranger would on 2026-11-21.
     *
     * Every refusal reported `remaining: 0`, and the page writes whatever it
     * is sent straight onto "N of 5 drafts left today". So a visitor refused
     * for the *minute* -- with three of five still theirs -- read on the
     * product's front door that their day was gone, beside a message telling
     * them to wait a minute. Two sentences, one screen, contradicting each
     * other, and the one anybody acts on is the number.
     */
    const { dependencies } = deps({ publicRemaining: new PublicAiRateLimitError("burst_limit", 60, "req-1", 3) });
    const error = await reserveFreeToolRun(input, dependencies).catch((caught) => caught);

    expect(freeToolLimitBody(error).remaining).toBe(3);
  });

  it("still says zero when the day really is spent", async () => {
    const { dependencies } = deps({ publicRemaining: new PublicAiRateLimitError("daily_limit", 3600, "req-1", 0) });
    const error = await reserveFreeToolRun(input, dependencies).catch((caught) => caught);

    expect(freeToolLimitBody(error).remaining).toBe(0);
  });

  it("carries a workspace's real remaining through the same way", async () => {
    // The paying side had the identical bug, and a workspace reading "0 left
    // today" after one quick second click is a support message at best.
    const { dependencies } = deps({
      identity: { userId: "user_1", orgId: "org_1" },
      team: "3b6c7a52-3b4e-4c65-8a35-1a2b3c4d5e6f",
      teamRemaining: new OrganizationAiRateLimitError("organization_burst_limit", 60, 41),
    });
    const error = await reserveFreeToolRun(input, dependencies).catch((caught) => caught);

    expect(freeToolLimitBody(error).remaining).toBe(41);
  });
});
