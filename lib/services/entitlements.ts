import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";

/**
 * What an organization is actually allowed to do.
 *
 * Subscriptions were recorded, entitlement rows were written from Stripe
 * webhooks, and nothing read them. Every organization got the same limits
 * whether it paid or not, which is worse than having no paid plan at all: it
 * takes money and returns exactly what was already free.
 *
 * This is the one place that answers the question. The Stripe webhook decides
 * what a subscription grants; this decides what those grants mean at the moment
 * of use, so a lapsed or cancelled subscription stops applying the instant its
 * entitlement stops being effective rather than at some later sweep.
 *
 * Free is the floor, never zero. Losing a subscription returns an organization
 * to the free allowance; it never locks them out of their own evidence, which
 * they created and which is a record they may be required to keep.
 */

/** The entitlement the paid plan grants for AI usage. */
export const AI_WORKFLOWS_ENTITLEMENT = "ai.workflows";

export type OrganizationLimits = {
  plan: "FREE" | "TEAM";
  aiDailyLimit: number;
  aiMinuteLimit: number;
};

/**
 * The free allowance is exactly what it already was.
 *
 * Introducing a paid tier is not a licence to move the free line: anyone
 * already using the product agreed to what they have, and quietly changing it
 * while adding a way to pay would make the paid tier look like the reason. The
 * paid tier has to earn its price by offering more, not by taking away.
 */
export const FREE_LIMITS = { aiDailyLimit: 20, aiMinuteLimit: 4 } as const;
/**
 * Set against arithmetic rather than against how generous it sounds.
 *
 * Every operation is a real model call billed to whoever runs this deployment.
 * At current gpt-5-mini rates an operation costs on the order of a cent, so a
 * subscriber who used 150 a day would cost about $31 a month against $19 of
 * revenue -- a plan that loses money precisely on the customers who like it
 * most. Sixty a day is three times the free allowance and stays profitable even
 * when a subscriber uses every single one, which is the only number worth
 * publishing: a ceiling you cannot afford to have taken up is not a limit, it
 * is a hope.
 */
export const TEAM_LIMITS = { aiDailyLimit: 60, aiMinuteLimit: 12 } as const;

function numeric(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * True when the entitlement is granted and in force right now.
 *
 * Both dates are checked rather than trusting `enabled` alone: a cancellation
 * writes an `effectiveUntil` and a scheduled upgrade can write an
 * `effectiveFrom` in the future, and an entitlement that has expired must stop
 * applying immediately.
 */
function isEffective(
  entitlement: { enabled: boolean; effectiveFrom: Date; effectiveUntil: Date | null },
  now: Date,
): boolean {
  if (!entitlement.enabled) return false;
  if (entitlement.effectiveFrom > now) return false;
  if (entitlement.effectiveUntil && entitlement.effectiveUntil <= now) return false;
  return true;
}

export async function getOrganizationLimits(input: {
  organizationId: string;
  prisma?: PrismaClient;
  now?: Date;
  source?: Readonly<Record<string, string | undefined>>;
}): Promise<OrganizationLimits> {
  const prisma = input.prisma ?? getPrismaClient();
  const now = input.now ?? new Date();
  const source = input.source ?? process.env;

  // A lookup failure falls back to the free allowance rather than throwing.
  // Rate limiting must keep working when the database is briefly unavailable,
  // and the safe direction is unambiguous: never grant paid limits because a
  // query failed. A paying customer is briefly under-served; nobody is
  // over-served, and nobody is locked out.
  let entitlement: {
    enabled: boolean;
    effectiveFrom: Date;
    effectiveUntil: Date | null;
    limitValue: number | null;
  } | null = null;
  try {
    entitlement = await prisma.organizationEntitlement.findUnique({
      where: {
        organizationId_key: {
          organizationId: input.organizationId,
          key: AI_WORKFLOWS_ENTITLEMENT,
        },
      },
      select: { enabled: true, effectiveFrom: true, effectiveUntil: true, limitValue: true },
    });
  } catch {
    entitlement = null;
  }

  const paid = entitlement ? isEffective(entitlement, now) : false;

  // Environment overrides stay available for both tiers, because the operator
  // running this deployment is the one paying the model bill.
  const freeDaily = numeric(source.ORGANIZATION_AI_DAILY_LIMIT, FREE_LIMITS.aiDailyLimit);
  const freeMinute = numeric(source.ORGANIZATION_AI_MINUTE_LIMIT, FREE_LIMITS.aiMinuteLimit);
  const teamDaily = numeric(source.ORGANIZATION_AI_TEAM_DAILY_LIMIT, TEAM_LIMITS.aiDailyLimit);
  const teamMinute = numeric(source.ORGANIZATION_AI_TEAM_MINUTE_LIMIT, TEAM_LIMITS.aiMinuteLimit);

  if (!paid) {
    return { plan: "FREE", aiDailyLimit: freeDaily, aiMinuteLimit: freeMinute };
  }

  return {
    plan: "TEAM",
    // A per-organization limitValue lets support raise a single customer's
    // ceiling without a deploy, which is otherwise the moment somebody edits a
    // constant and ships it to everyone.
    aiDailyLimit: entitlement?.limitValue ?? teamDaily,
    aiMinuteLimit: teamMinute,
  };
}
