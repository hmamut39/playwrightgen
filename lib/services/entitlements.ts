import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { OPENING_TRIAL_DAYS } from "@/lib/plan";
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
  /**
   * When this workspace's opening allowance runs out, if it is on one.
   *
   * Null for a workspace that pays and for one past its first days. The plan
   * says TEAM either way, because that is what the ceiling is; this is how a
   * page can say the rest of the truth, which is that it ends.
   */
  trialEndsAt: Date | null;
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

/**
 * How long a new workspace keeps the Team ceiling, for nothing.
 *
 * The free allowance is twenty AI actions a day. One "Cover a page" of four
 * tests costs up to twelve -- one to write each test and up to two more to fix
 * it -- so three people evaluating together spend the whole day in their first
 * ten minutes, on the feature the home page leads with, and meet "This
 * workspace has used today's AI allowance. It resets at midnight UTC": true,
 * well worded, and the end of their evaluation.
 *
 * Until now the only remedy was `scripts/grant-trial-allowance.mjs`, run by
 * hand against production for each workspace. That does not survive strangers
 * signing up while the owner is asleep, which is exactly what January is.
 *
 * Derived from the workspace's own creation date rather than written into a
 * row. Nothing has to be granted, nothing has to be cleaned up, and there is
 * no way to leave somebody on a free Team plan nobody remembers giving them --
 * the three ways the stored version goes wrong. It also needs no migration,
 * so it cannot be half-deployed.
 */
/**
 * The same number the pricing page advertises, read from where it is
 * advertised. Two copies of this drifted to 7 and 14; one of them is now the
 * only one.
 */
export const TRIAL_DAYS = OPENING_TRIAL_DAYS;

function numeric(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The same, for a number where zero is a decision rather than a mistake.
 *
 * `numeric` refuses zero and falls back, which is right for a ceiling -- a
 * limit of none would lock everyone out, and reading it from an environment
 * variable is exactly how that happens by accident. A length of trial is not a
 * ceiling: zero days means a deployment that does not want to give anything
 * away, and silently turning that into fourteen would be the opposite of what
 * whoever typed it asked for.
 */
function days(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
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

  // When the workspace was made, for the opening allowance. Read in its own
  // try for the same reason as the entitlement: a lookup that fails must fall
  // back to the free allowance rather than throw, and the safe direction is
  // never to grant more because a query failed.
  let createdAt: Date | null = null;
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: input.organizationId },
      select: { createdAt: true },
    });
    createdAt = organization?.createdAt ?? null;
  } catch {
    createdAt = null;
  }

  const paid = entitlement ? isEffective(entitlement, now) : false;

  // Environment overrides stay available for both tiers, because the operator
  // running this deployment is the one paying the model bill.
  const freeDaily = numeric(source.ORGANIZATION_AI_DAILY_LIMIT, FREE_LIMITS.aiDailyLimit);
  const freeMinute = numeric(source.ORGANIZATION_AI_MINUTE_LIMIT, FREE_LIMITS.aiMinuteLimit);
  const teamDaily = numeric(source.ORGANIZATION_AI_TEAM_DAILY_LIMIT, TEAM_LIMITS.aiDailyLimit);
  const teamMinute = numeric(source.ORGANIZATION_AI_TEAM_MINUTE_LIMIT, TEAM_LIMITS.aiMinuteLimit);

  if (!paid) {
    // The opening allowance. Read from when the workspace was made, so it
    // ends on its own and there is nothing to revoke. Zero days turns it off
    // for a deployment that does not want to give anything away.
    const trialDays = days(source.ORGANIZATION_TRIAL_DAYS, TRIAL_DAYS);
    const endsAt =
      trialDays > 0 && createdAt
        ? new Date(createdAt.getTime() + trialDays * 24 * 60 * 60 * 1_000)
        : null;
    if (endsAt && endsAt > now) {
      return {
        plan: "TEAM",
        aiDailyLimit: teamDaily,
        aiMinuteLimit: teamMinute,
        trialEndsAt: endsAt,
      };
    }
    return { plan: "FREE", aiDailyLimit: freeDaily, aiMinuteLimit: freeMinute, trialEndsAt: null };
  }

  return {
    plan: "TEAM",
    // Paid, so there is no trial to end. A workspace that subscribed during
    // its first fortnight should not be told its allowance expires on Friday.
    trialEndsAt: null,
    // A per-organization limitValue lets support raise a single customer's
    // ceiling without a deploy, which is otherwise the moment somebody edits a
    // constant and ships it to everyone.
    aiDailyLimit: entitlement?.limitValue ?? teamDaily,
    aiMinuteLimit: teamMinute,
  };
}
