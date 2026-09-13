import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  dispatchClerkWebhook,
  reconcileClerkOrganizationSnapshot,
  type ClerkReconciliationSnapshot,
} from "@/lib/services/clerk-sync";

/**
 * Creates the local mirror of a Clerk organization on demand.
 *
 * Organizations reach the database through Clerk webhooks. That works until a
 * delivery is missed -- an endpoint not yet registered for an environment, an
 * outage, a signature rejected during a key rotation -- and then Clerk holds a
 * membership the database has never heard of. Every workspace page then threw
 * `workspace_not_found`, which a server component turns into a bare "This page
 * couldn't load". The person is signed in, genuinely a member, and locked out
 * of their own workspace with no way to recover from inside the product.
 *
 * So a missing organization is treated as a delivery to catch up on rather than
 * as an error. Clerk is the source of truth for identity: the session already
 * proves this membership, and the same reconciliation the webhook performs is
 * run against a snapshot fetched directly from Clerk.
 *
 * This does not replace the webhook, which still carries renames, role changes
 * and removals as they happen. It removes the webhook from the path that
 * decides whether someone can open the product at all.
 */

type ClerkSnapshotFetcher = (
  clerkOrganizationId: string,
) => Promise<ClerkReconciliationSnapshot | null>;

/** Clerk paginates memberships; a workspace larger than this is not backfilled here. */
const MEMBERSHIP_PAGE_LIMIT = 100;

async function fetchClerkSnapshot(
  clerkOrganizationId: string,
): Promise<ClerkReconciliationSnapshot | null> {
  const client = await clerkClient();
  const organization = await client.organizations.getOrganization({
    organizationId: clerkOrganizationId,
  });
  if (!organization) return null;

  const memberships = await client.organizations.getOrganizationMembershipList({
    organizationId: clerkOrganizationId,
    limit: MEMBERSHIP_PAGE_LIMIT,
  });

  const now = new Date();
  const users: Array<ClerkReconciliationSnapshot["users"][number]> = [];
  const rows: Array<{
    id: string;
    organizationId: string;
    userId: string;
    role: string;
    updatedAt: Date;
  }> = [];

  for (const membership of memberships.data) {
    const userId = membership.publicUserData?.userId;
    // A membership whose user Clerk did not expose cannot be mirrored, and
    // reconciliation rejects a snapshot referencing a user it was not given.
    if (!userId) continue;

    const name = [membership.publicUserData?.firstName, membership.publicUserData?.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    users.push({
      id: userId,
      primaryEmail: membership.publicUserData?.identifier ?? null,
      displayName: name || membership.publicUserData?.identifier || null,
      avatarUrl: membership.publicUserData?.imageUrl ?? null,
      disabled: false,
      updatedAt: new Date(membership.updatedAt ?? now),
    });
    rows.push({
      id: membership.id,
      organizationId: clerkOrganizationId,
      userId,
      role: membership.role,
      updatedAt: new Date(membership.updatedAt ?? now),
    });
  }

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug ?? organization.id,
      createdBy: organization.createdBy ?? null,
      updatedAt: new Date(organization.updatedAt ?? now),
    },
    users,
    memberships: rows,
  };
}

/**
 * Returns true when the organization now exists locally.
 *
 * Failure is deliberately quiet. This runs on a path that was already about to
 * fail, so a Clerk outage or an unexpected payload should leave the original
 * "not found" in place rather than replace it with a second, less informative
 * error about provisioning.
 */
export async function provisionWorkspaceFromClerk(input: {
  clerkOrganizationId: string;
  prisma: PrismaClient;
  fetchSnapshot?: ClerkSnapshotFetcher;
}): Promise<boolean> {
  if (!input.fetchSnapshot && process.env.PLAYWRIGHTGEN_DISABLE_CLERK_RECOVERY === "1") {
    return false;
  }
  try {
    const snapshot = await (input.fetchSnapshot ?? fetchClerkSnapshot)(
      input.clerkOrganizationId,
    );
    if (!snapshot || snapshot.memberships.length === 0) {
      console.warn("[provisioning] Clerk listed no memberships yet", { clerkOrganizationId: input.clerkOrganizationId });
      return false;
    }

    await reconcileClerkOrganizationSnapshot({
      snapshot,
      apply: true,
      prisma: input.prisma,
    });
    return true;
  } catch (error) {
    // Quiet for the person, not for us: without this the reason a workspace
    // could not be recovered was invisible in the logs.
    console.warn("[provisioning] workspace recovery failed", {
      clerkOrganizationId: input.clerkOrganizationId,
      message: error instanceof Error ? error.message.slice(0, 300) : String(error),
    });
    return false;
  }
}

type ClerkMembershipFetcher = (input: {
  clerkOrganizationId: string;
  clerkUserId: string;
}) => Promise<unknown | null>;

async function fetchClerkMembership(input: {
  clerkOrganizationId: string;
  clerkUserId: string;
}): Promise<unknown | null> {
  const client = await clerkClient();
  const memberships = await client.users.getOrganizationMembershipList({
    userId: input.clerkUserId,
    limit: 100,
  });
  const membership = memberships.data.find(
    (candidate) => candidate.organization.id === input.clerkOrganizationId,
  );
  // The raw JSON is the same shape a webhook delivers, so it can go through
  // the webhook's own validation and sync rather than a second code path.
  return membership?.raw ?? null;
}

/**
 * Creates one person's local membership from Clerk, on demand.
 *
 * The organization exists but this person's membership does not -- the usual
 * state for a few seconds after someone accepts an invitation and is sent
 * straight into the workspace, before Clerk's webhook lands. Without this
 * they met "forbidden" on their very first page in a team they had just
 * joined. The membership is fetched from Clerk and applied through the same
 * sync as the webhook, including the project roles they were invited with.
 * When the webhook then arrives it finds the work done.
 *
 * Returns true when a membership was applied. Quiet on failure: a person with
 * no membership in Clerk either is simply not a member.
 */
export async function provisionMembershipFromClerk(input: {
  clerkOrganizationId: string;
  clerkUserId: string;
  prisma: PrismaClient;
  fetchMembership?: ClerkMembershipFetcher;
}): Promise<boolean> {
  if (!input.fetchMembership && process.env.PLAYWRIGHTGEN_DISABLE_CLERK_RECOVERY === "1") {
    return false;
  }
  try {
    const raw = await (input.fetchMembership ?? fetchClerkMembership)(input);
    if (!raw || typeof raw !== "object") return false;
    const membership = raw as { id?: string; updated_at?: number };
    const result = await dispatchClerkWebhook({
      type: "organizationMembership.created",
      data: raw,
      eventId: `recovery:${membership.id ?? "unknown"}:${membership.updated_at ?? 0}`,
      prisma: input.prisma,
    });
    return result.status === "applied" || result.status === "duplicate";
  } catch (error) {
    console.warn("[provisioning] membership recovery failed", {
      clerkOrganizationId: input.clerkOrganizationId,
      message: error instanceof Error ? error.message.slice(0, 300) : String(error),
    });
    return false;
  }
}
