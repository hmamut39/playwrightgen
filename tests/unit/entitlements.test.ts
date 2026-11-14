import { describe, expect, it } from "vitest";

import {
  FREE_LIMITS,
  TEAM_LIMITS,
  TRIAL_DAYS,
  getOrganizationLimits,
} from "@/lib/services/entitlements";

const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-09-07T12:00:00.000Z");

/** Stands in for Prisma with only the call this module makes. */
function prismaReturning(
  entitlement: {
    enabled: boolean;
    effectiveFrom: Date;
    effectiveUntil: Date | null;
    limitValue: number | null;
  } | null,
) {
  return {
    organizationEntitlement: { findUnique: async () => entitlement },
    // Old enough that the opening allowance has long since ended, so every
    // case written before it existed still measures what it meant to.
    organization: { findUnique: async () => ({ createdAt: new Date("2026-01-01T00:00:00.000Z") }) },
  } as never;
}

/** A workspace made at a given moment, with nothing granted to it. */
function prismaForWorkspaceMade(createdAt: Date) {
  return {
    organizationEntitlement: { findUnique: async () => null },
    organization: { findUnique: async () => ({ createdAt }) },
  } as never;
}

function prismaThatFails() {
  return {
    organizationEntitlement: {
      findUnique: async () => {
        throw new Error("connection lost");
      },
    },
    organization: {
      findUnique: async () => {
        throw new Error("connection lost");
      },
    },
  } as never;
}

const granted = (overrides: Partial<{
  enabled: boolean;
  effectiveFrom: Date;
  effectiveUntil: Date | null;
  limitValue: number | null;
}> = {}) => ({
  enabled: true,
  effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
  effectiveUntil: null,
  limitValue: null,
  ...overrides,
});

describe("what an organization is allowed to do", () => {
  it("gives the free allowance when nothing has been granted", async () => {
    const limits = await getOrganizationLimits({
      organizationId: ORG,
      prisma: prismaReturning(null),
      now: NOW,
      source: {},
    });

    expect(limits).toEqual({ plan: "FREE", ...FREE_LIMITS, trialEndsAt: null });
  });

  it("raises the allowance for an organization that pays", async () => {
    // The point of the whole exercise: subscriptions were recorded and never
    // read, so paying changed nothing at all.
    const limits = await getOrganizationLimits({
      organizationId: ORG,
      prisma: prismaReturning(granted()),
      now: NOW,
      source: {},
    });

    expect(limits).toEqual({ plan: "TEAM", ...TEAM_LIMITS, trialEndsAt: null });
  });

  it("stops applying the moment an entitlement expires", async () => {
    // A cancellation writes effectiveUntil. Trusting `enabled` alone would keep
    // serving paid limits to a subscription that has ended.
    const limits = await getOrganizationLimits({
      organizationId: ORG,
      prisma: prismaReturning(
        granted({ effectiveUntil: new Date("2026-09-06T00:00:00.000Z") }),
      ),
      now: NOW,
      source: {},
    });

    expect(limits.plan).toBe("FREE");
  });

  it("does not apply an entitlement that has not started", async () => {
    const limits = await getOrganizationLimits({
      organizationId: ORG,
      prisma: prismaReturning(
        granted({ effectiveFrom: new Date("2026-10-01T00:00:00.000Z") }),
      ),
      now: NOW,
      source: {},
    });

    expect(limits.plan).toBe("FREE");
  });

  it("treats a disabled entitlement as no entitlement", async () => {
    const limits = await getOrganizationLimits({
      organizationId: ORG,
      prisma: prismaReturning(granted({ enabled: false })),
      now: NOW,
      source: {},
    });

    expect(limits.plan).toBe("FREE");
  });

  it("honours a per-organization ceiling without a deploy", async () => {
    const limits = await getOrganizationLimits({
      organizationId: ORG,
      prisma: prismaReturning(granted({ limitValue: 2_000 })),
      now: NOW,
      source: {},
    });

    expect(limits).toMatchObject({ plan: "TEAM", aiDailyLimit: 2_000 });
  });

  it("falls back to free when the lookup fails, never to paid", async () => {
    // Rate limiting has to keep working during a database blip, and the safe
    // direction is unambiguous: a query failure must never grant paid limits.
    const limits = await getOrganizationLimits({
      organizationId: ORG,
      prisma: prismaThatFails(),
      now: NOW,
      source: {},
    });

    expect(limits).toEqual({ plan: "FREE", ...FREE_LIMITS, trialEndsAt: null });
  });

  it("lets the operator override either tier, since they pay the model bill", async () => {
    const free = await getOrganizationLimits({
      organizationId: ORG,
      prisma: prismaReturning(null),
      now: NOW,
      source: { ORGANIZATION_AI_DAILY_LIMIT: "7" },
    });
    const team = await getOrganizationLimits({
      organizationId: ORG,
      prisma: prismaReturning(granted()),
      now: NOW,
      source: { ORGANIZATION_AI_TEAM_DAILY_LIMIT: "900" },
    });

    expect(free.aiDailyLimit).toBe(7);
    expect(team.aiDailyLimit).toBe(900);
  });

  it("ignores a nonsensical override rather than locking everyone out", async () => {
    const limits = await getOrganizationLimits({
      organizationId: ORG,
      prisma: prismaReturning(null),
      now: NOW,
      source: { ORGANIZATION_AI_DAILY_LIMIT: "0" },
    });

    expect(limits.aiDailyLimit).toBe(FREE_LIMITS.aiDailyLimit);
  });
});

/**
 * The allowance a workspace gets for existing.
 *
 * Twenty AI actions a day is the free line, and one "Cover a page" of four
 * tests costs up to twelve. Three people evaluating together spend the day in
 * their first ten minutes, on the feature the home page leads with, and meet
 * "This workspace has used today's AI allowance" -- true, well worded, and the
 * end of their evaluation. January is a week of exactly those people.
 *
 * Derived from when the workspace was made rather than granted as a row:
 * nothing to clean up, nothing to revoke, and no way to leave somebody on a
 * free Team plan nobody remembers giving them.
 */
describe("the opening allowance", () => {
  const madeDaysAgo = (days: number) =>
    prismaForWorkspaceMade(new Date(NOW.getTime() - days * 24 * 60 * 60 * 1_000));

  it("gives a new workspace the Team ceiling, and says when it ends", async () => {
    const limits = await getOrganizationLimits({
      organizationId: ORG,
      prisma: madeDaysAgo(1),
      now: NOW,
      source: {},
    });

    expect(limits.plan).toBe("TEAM");
    expect(limits.aiDailyLimit).toBe(TEAM_LIMITS.aiDailyLimit);
    // The rest of the truth, which a page has to be able to tell them.
    expect(limits.trialEndsAt?.toISOString()).toBe("2026-09-20T12:00:00.000Z");
  });

  it("ends by itself, with nobody revoking anything", async () => {
    const limits = await getOrganizationLimits({
      organizationId: ORG,
      prisma: madeDaysAgo(TRIAL_DAYS + 1),
      now: NOW,
      source: {},
    });

    expect(limits).toEqual({ plan: "FREE", ...FREE_LIMITS, trialEndsAt: null });
  });

  it("does not tell a paying workspace its allowance expires on Friday", async () => {
    // Subscribing during the first fortnight must not read as a countdown.
    const limits = await getOrganizationLimits({
      organizationId: ORG,
      prisma: {
        organizationEntitlement: { findUnique: async () => granted() },
        organization: { findUnique: async () => ({ createdAt: new Date(NOW.getTime() - 86_400_000) }) },
      } as never,
      now: NOW,
      source: {},
    });

    expect(limits.plan).toBe("TEAM");
    expect(limits.trialEndsAt).toBeNull();
  });

  it("can be switched off entirely by the deployment paying the bill", async () => {
    const limits = await getOrganizationLimits({
      organizationId: ORG,
      prisma: madeDaysAgo(1),
      now: NOW,
      source: { ORGANIZATION_TRIAL_DAYS: "0" },
    });

    expect(limits.plan).toBe("FREE");
    expect(limits.trialEndsAt).toBeNull();
  });

  it("gives nothing away when the workspace cannot be read", async () => {
    // Same direction as every other fallback here: a query that failed never
    // grants more. A workspace is briefly under-served; nobody is over-served.
    const limits = await getOrganizationLimits({
      organizationId: ORG,
      prisma: prismaThatFails(),
      now: NOW,
      source: {},
    });

    expect(limits).toEqual({ plan: "FREE", ...FREE_LIMITS, trialEndsAt: null });
  });
});
