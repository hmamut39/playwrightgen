import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

import type { PrismaClient } from "@/generated/prisma/client";
import {
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
  try {
    const snapshot = await (input.fetchSnapshot ?? fetchClerkSnapshot)(
      input.clerkOrganizationId,
    );
    if (!snapshot || snapshot.memberships.length === 0) return false;

    await reconcileClerkOrganizationSnapshot({
      snapshot,
      apply: true,
      prisma: input.prisma,
    });
    return true;
  } catch {
    return false;
  }
}
