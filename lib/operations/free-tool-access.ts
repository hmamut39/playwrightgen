import "server-only";

import { auth } from "@clerk/nextjs/server";

import { getPrismaClient } from "@/lib/db/prisma";
import {
  OrganizationAiRateLimitError,
  readOrganizationAiAllowance,
  reserveOrganizationAiRequest,
} from "@/lib/operations/organization-ai-guard";
import {
  PublicAiRateLimitError,
  readPublicAiAllowance,
  reservePublicAiRequest,
} from "@/lib/operations/public-ai-guard";
import { getOrganizationLimits } from "@/lib/services/entitlements";

/**
 * Who pays for one run of a free tool.
 *
 * Every visitor had the same five runs a day per tool, counted by address, and
 * the sixth answered "Too many requests" -- to a stranger and to a paying
 * customer alike. The moment someone liked the tool enough to want more was
 * the moment it gave them an error and no way forward.
 *
 * A signed-in person whose workspace is on the Team plan now draws on the
 * workspace's daily AI allowance instead, the same pool the workspace's own AI
 * features use. Everyone else keeps five a day; when those run out, the
 * response says so in a way the page turns into an upgrade offer rather than
 * an error.
 */

export type FreeToolSurface = "quick-generate" | "coverage-review" | "release-review";

export type FreeToolRun = {
  plan: "TEAM" | "PUBLIC";
  /** Runs left today in whichever allowance paid for this one. */
  remaining: number;
  /** The signed-in person (Clerk user id), so the tool can keep their result. */
  userId: string | null;
};

export class FreeToolLimitError extends Error {
  constructor(
    readonly plan: "TEAM" | "PUBLIC",
    readonly code: "burst_limit" | "daily_limit",
    readonly retryAfterSeconds: number,
  ) {
    super(code);
    this.name = "FreeToolLimitError";
  }
}

type Identity = { userId: string | null; orgId: string | null };

type Dependencies = {
  identify?: () => Promise<Identity>;
  findTeamOrganization?: (clerkOrganizationId: string) => Promise<string | null>;
  reserveTeam?: (organizationId: string) => Promise<number>;
  reservePublic?: (request: Request, surface: FreeToolSurface, requestId: string) => Promise<number>;
};

async function identifyFromSession(): Promise<Identity> {
  try {
    const { userId, orgId } = await auth();
    return { userId: userId ?? null, orgId: orgId ?? null };
  } catch {
    // No session (or the middleware did not run): treat as a visitor.
    return { userId: null, orgId: null };
  }
}

/** The workspace's id when it is on the Team plan, otherwise null. */
async function findTeamOrganization(clerkOrganizationId: string): Promise<string | null> {
  const organization = await getPrismaClient().organization.findUnique({
    where: { clerkOrganizationId },
    select: { id: true, status: true },
  });
  if (!organization || organization.status !== "ACTIVE") return null;
  const limits = await getOrganizationLimits({ organizationId: organization.id });
  return limits.plan === "TEAM" ? organization.id : null;
}

async function reserveTeam(organizationId: string): Promise<number> {
  const reservation = await reserveOrganizationAiRequest({ organizationId, surface: "free-tools" });
  return reservation.dailyRemaining;
}

async function reservePublic(request: Request, surface: FreeToolSurface, requestId: string) {
  const reservation = await reservePublicAiRequest({ request, surface, requestId });
  return reservation.remaining;
}

export async function reserveFreeToolRun(
  input: { request: Request; surface: FreeToolSurface; requestId: string },
  dependencies: Dependencies = {},
): Promise<FreeToolRun> {
  const identity = await (dependencies.identify ?? identifyFromSession)();

  if (identity.userId && identity.orgId) {
    let teamOrganizationId: string | null = null;
    try {
      teamOrganizationId = await (dependencies.findTeamOrganization ?? findTeamOrganization)(identity.orgId);
    } catch {
      // Never grant the paid allowance because a lookup failed.
      teamOrganizationId = null;
    }
    if (teamOrganizationId) {
      try {
        return {
          plan: "TEAM",
          remaining: await (dependencies.reserveTeam ?? reserveTeam)(teamOrganizationId),
          userId: identity.userId,
        };
      } catch (error) {
        if (error instanceof OrganizationAiRateLimitError) {
          throw new FreeToolLimitError(
            "TEAM",
            error.code === "organization_burst_limit" ? "burst_limit" : "daily_limit",
            error.retryAfterSeconds,
          );
        }
        throw error;
      }
    }
  }

  try {
    return {
      plan: "PUBLIC",
      remaining: await (dependencies.reservePublic ?? reservePublic)(input.request, input.surface, input.requestId),
      userId: identity.userId,
    };
  } catch (error) {
    if (error instanceof PublicAiRateLimitError) {
      throw new FreeToolLimitError("PUBLIC", error.code, error.retryAfterSeconds);
    }
    throw error;
  }
}

/** The body a free-tool route returns when a run is refused. */
export function freeToolLimitBody(error: FreeToolLimitError) {
  const message =
    error.code === "burst_limit"
      ? "That was quick — wait a minute before the next run."
      : error.plan === "TEAM"
        ? "Your workspace has used today's AI allowance. It resets at midnight UTC."
        : "You've used today's 5 free runs of this tool.";
  return {
    error: message,
    code: error.code,
    plan: error.plan,
    retryAfterSeconds: error.retryAfterSeconds,
    // The page offers the Team plan only when paying would actually help.
    upgrade: error.plan === "PUBLIC" && error.code === "daily_limit",
    remaining: 0,
  };
}

export type FreeToolAllowance = {
  plan: "TEAM" | "PUBLIC";
  remaining: number;
  limit: number;
};

/**
 * What this caller has left for a free tool today, without using any of it.
 *
 * The tools used to answer "you have used today's allowance" only after the
 * click, which reads as a fault rather than a limit. This is the same decision
 * `reserveFreeToolRun` makes -- Team workspace allowance, otherwise the
 * visitor's daily runs -- read rather than spent.
 */
export async function readFreeToolAllowance(
  input: { request: Request; surface: FreeToolSurface },
  dependencies: {
    identify?: () => Promise<Identity>;
    findTeamOrganization?: (clerkOrganizationId: string) => Promise<string | null>;
    readTeam?: (organizationId: string) => Promise<{ remaining: number; limit: number }>;
    readPublic?: (request: Request, surface: FreeToolSurface) => Promise<{ remaining: number; limit: number }>;
  } = {},
): Promise<FreeToolAllowance> {
  const readTeam =
    dependencies.readTeam ??
    (async (organizationId: string) => {
      const allowance = await readOrganizationAiAllowance({ organizationId });
      return { remaining: allowance.dailyRemaining, limit: allowance.dailyLimit };
    });
  const readPublic =
    dependencies.readPublic ??
    (async (request: Request, surface: FreeToolSurface) => {
      const allowance = await readPublicAiAllowance({ request, surface });
      return { remaining: allowance.remaining, limit: allowance.dailyLimit };
    });

  const identity = await (dependencies.identify ?? identifyFromSession)();
  if (identity.userId && identity.orgId) {
    try {
      const teamOrganizationId = await (dependencies.findTeamOrganization ?? findTeamOrganization)(identity.orgId);
      if (teamOrganizationId) return { plan: "TEAM", ...(await readTeam(teamOrganizationId)) };
    } catch {
      // A lookup that fails must not claim the paid allowance.
    }
  }
  return { plan: "PUBLIC", ...(await readPublic(input.request, input.surface)) };
}
