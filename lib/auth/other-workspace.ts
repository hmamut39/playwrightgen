import "server-only";

import { auth, clerkClient } from "@clerk/nextjs/server";

import { getPrismaClient } from "@/lib/db/prisma";

/**
 * The workspace in the address, when it is one this person may open but is
 * not the one they are currently in.
 *
 * A workspace page is resolved from the **session's active organization**,
 * not from the slug in the address:
 *
 *     organization.findUnique({ where: { clerkOrganizationId: authState.orgId } })
 *     if (input.orgSlug && input.orgSlug !== organization.slug) notFound();
 *
 * So anybody in two workspaces who follows a link into the other one is told
 * "That page is not here", about a project they own, with no hint that the
 * answer is a switcher at the top of a page they cannot reach. A teammate
 * sharing a link is the ordinary way this happens, and the person receiving
 * it has no way to work out what went wrong.
 *
 * Found on 2026-11-22 by the owner, who could not open his own demo
 * workspace after it was repaired -- his session was still in the other one.
 *
 * Only a membership makes this visible. For somebody who is not a member the
 * answer stays "not found", which is also what it should be: whether a
 * workspace exists is not something an address should be able to probe.
 */
export type OpenableWorkspace = { name: string; slug: string; clerkOrganizationId: string };

export type OtherWorkspaceDependencies = {
  authenticate?: () => Promise<{ userId: string | null; orgId: string | null }>;
  prisma?: ReturnType<typeof getPrismaClient>;
  clerkMemberships?: (userId: string) => Promise<string[]>;
};

async function defaultAuthenticate() {
  const state = await auth();
  return { userId: state.userId ?? null, orgId: state.orgId ?? null };
}

async function defaultClerkMemberships(userId: string): Promise<string[]> {
  const client = await clerkClient();
  const memberships = await client.users.getOrganizationMembershipList({ userId, limit: 100 });
  return memberships.data.map((membership) => membership.organization.id);
}

export async function workspaceYouCanOpen(
  orgSlug: string,
  dependencies: OtherWorkspaceDependencies = {},
): Promise<OpenableWorkspace | null> {
  const authenticate = dependencies.authenticate ?? defaultAuthenticate;
  const { userId, orgId } = await authenticate();
  if (!userId) return null;

  const prisma = dependencies.prisma ?? getPrismaClient();
  const organization = await prisma.organization.findFirst({
    where: { slug: orgSlug },
    select: { name: true, slug: true, clerkOrganizationId: true, status: true },
  });
  if (!organization || organization.status !== "ACTIVE") return null;
  // Already the active one: whatever went wrong, it was not this.
  if (orgId && orgId === organization.clerkOrganizationId) return null;

  const user = await prisma.user.findUnique({ where: { clerkUserId: userId }, select: { id: true } });
  if (user) {
    const membership = await prisma.membership.findFirst({
      where: { userId: user.id, organization: { slug: orgSlug }, status: "ACTIVE" },
      select: { id: true },
    });
    if (membership) {
      return {
        name: organization.name,
        slug: organization.slug,
        clerkOrganizationId: organization.clerkOrganizationId,
      };
    }
  }

  /*
   * No row here, so ask the identity provider. This is the same reasoning
   * `provisionMembershipFromClerk` uses: a membership the database has not
   * heard of is a delivery to catch up on, not a refusal -- and switching is
   * what makes the catch-up happen, because the next page load resolves this
   * organization as the active one and writes the row.
   */
  const clerkMemberships = dependencies.clerkMemberships ?? defaultClerkMemberships;
  const belongsTo = await clerkMemberships(userId).catch(() => [] as string[]);
  if (!belongsTo.includes(organization.clerkOrganizationId)) return null;

  return {
    name: organization.name,
    slug: organization.slug,
    clerkOrganizationId: organization.clerkOrganizationId,
  };
}
