import { describe, expect, it } from "vitest";

import {
  FREE_LIMITS,
  TEAM_LIMITS,
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
  } as never;
}

function prismaThatFails() {
  return {
    organizationEntitlement: {
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

    expect(limits).toEqual({ plan: "FREE", ...FREE_LIMITS });
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

    expect(limits).toEqual({ plan: "TEAM", ...TEAM_LIMITS });
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

    expect(limits).toEqual({ plan: "FREE", ...FREE_LIMITS });
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
