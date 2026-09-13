import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import {
  createClerkSyncActivity,
} from "@/lib/services/activity";
import {
  ClerkWebhookPayloadError,
  type NormalizedClerkWebhookEvent,
  type NormalizedMembershipEvent,
  type NormalizedOrganizationDeletedEvent,
  type NormalizedOrganizationEvent,
  type NormalizedUserDeletedEvent,
  type NormalizedUserEvent,
  parseVerifiedClerkWebhook,
} from "@/lib/validation/clerk-webhook";

export type ClerkSyncResult = {
  status: "applied" | "duplicate" | "stale" | "ignored";
};

export type EventApplicationDecision = Exclude<
  ClerkSyncResult["status"],
  "ignored"
>;

export class ClerkSyncConflictError extends Error {
  constructor(message = "The Clerk synchronization event conflicts with local identity state.") {
    super(message);
    this.name = "ClerkSyncConflictError";
  }
}

export function mapClerkOrganizationRole(
  providerRole: string,
): "ADMIN" | "MEMBER" {
  const normalizedRole = providerRole.trim().toLowerCase();

  if (normalizedRole === "org:admin") {
    return "ADMIN";
  }
  if (normalizedRole === "org:member") {
    return "MEMBER";
  }

  throw new ClerkWebhookPayloadError(
    "The verified Clerk membership role is not supported.",
  );
}

export function decideEventApplication(input: {
  existingEventId: string | null;
  existingUpdatedAt: Date | null;
  incomingEventId: string;
  incomingUpdatedAt: Date | null;
}): EventApplicationDecision {
  if (input.existingEventId === input.incomingEventId) {
    return "duplicate";
  }

  if (
    input.existingUpdatedAt &&
    input.incomingUpdatedAt &&
    input.incomingUpdatedAt.getTime() < input.existingUpdatedAt.getTime()
  ) {
    return "stale";
  }

  return "applied";
}

export function shouldBootstrapOwner(input: {
  creatorUserId: string | null;
  membershipUserId: string;
  activeOwnerCount: number;
}): boolean {
  return (
    input.activeOwnerCount === 0 &&
    input.creatorUserId !== null &&
    input.creatorUserId === input.membershipUserId
  );
}

function isSerializableRetry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}

async function runSerializable<T>(
  client: PrismaClient,
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: "Serializable",
      });
    } catch (error: unknown) {
      if (!isSerializableRetry(error) || attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("Clerk synchronization transaction retry exhausted.");
}

function changedFields(
  comparisons: ReadonlyArray<readonly [field: string, changed: boolean]>,
): string[] {
  return comparisons
    .filter(([, changed]) => changed)
    .map(([field]) => field);
}

async function syncUserEvent(
  client: PrismaClient,
  event: NormalizedUserEvent,
  now: Date,
): Promise<ClerkSyncResult> {
  return runSerializable(client, async (transaction) => {
    const existing = await transaction.user.findUnique({
      where: { clerkUserId: event.clerkUserId },
    });

    if (existing) {
      const decision = decideEventApplication({
        existingEventId: existing.lastWebhookEventId,
        existingUpdatedAt: existing.clerkUpdatedAt,
        incomingEventId: event.eventId,
        incomingUpdatedAt: event.updatedAt,
      });

      if (decision !== "applied") {
        return { status: decision };
      }

      if (existing.status === "DELETED") {
        return { status: "stale" };
      }

      const status = event.disabled ? "DISABLED" : "ACTIVE";
      await transaction.user.update({
        where: { id: existing.id },
        data: {
          primaryEmail: event.primaryEmail,
          displayName: event.displayName,
          avatarUrl: event.avatarUrl,
          status,
          disabledAt:
            status === "DISABLED"
              ? existing.disabledAt ?? now
              : null,
          deletedAt: null,
          clerkUpdatedAt: event.updatedAt,
          lastWebhookEventId: event.eventId,
          lastSyncedAt: now,
        },
      });

      return { status: "applied" };
    }

    await transaction.user.create({
      data: {
        clerkUserId: event.clerkUserId,
        primaryEmail: event.primaryEmail,
        displayName: event.displayName,
        avatarUrl: event.avatarUrl,
        status: event.disabled ? "DISABLED" : "ACTIVE",
        disabledAt: event.disabled ? now : null,
        clerkUpdatedAt: event.updatedAt,
        lastWebhookEventId: event.eventId,
        lastSyncedAt: now,
      },
    });

    return { status: "applied" };
  });
}

async function syncUserDeletedEvent(
  client: PrismaClient,
  event: NormalizedUserDeletedEvent,
  now: Date,
): Promise<ClerkSyncResult> {
  return runSerializable(client, async (transaction) => {
    const existing = await transaction.user.findUnique({
      where: { clerkUserId: event.clerkUserId },
    });

    if (existing?.lastWebhookEventId === event.eventId) {
      return { status: "duplicate" };
    }

    if (
      existing?.clerkUpdatedAt &&
      event.updatedAt.getTime() < existing.clerkUpdatedAt.getTime()
    ) {
      return { status: "stale" };
    }

    const user = existing
      ? await transaction.user.update({
          where: { id: existing.id },
          data: {
            status: "DELETED",
            deletedAt: existing.deletedAt ?? now,
            disabledAt: existing.disabledAt,
            clerkUpdatedAt: event.updatedAt,
            lastWebhookEventId: event.eventId,
            lastSyncedAt: now,
          },
        })
      : await transaction.user.create({
          data: {
            clerkUserId: event.clerkUserId,
            status: "DELETED",
            deletedAt: now,
            clerkUpdatedAt: event.updatedAt,
            lastWebhookEventId: event.eventId,
            lastSyncedAt: now,
          },
        });

    const activeMemberships = await transaction.membership.findMany({
      where: {
        userId: user.id,
        status: { not: "REMOVED" },
      },
      select: {
        id: true,
        organizationId: true,
        status: true,
      },
    });

    for (const membership of activeMemberships) {
      await transaction.membership.update({
        where: { id: membership.id },
        data: {
          status: "REMOVED",
          removedAt: now,
          lastWebhookEventId: event.eventId,
          lastSyncedAt: now,
        },
      });
      await createClerkSyncActivity(transaction, {
        organizationId: membership.organizationId,
        action: "MEMBERSHIP_REMOVED",
        targetType: "MEMBERSHIP",
        targetId: membership.id,
        eventType: event.type,
        eventId: event.eventId,
        changedFields: ["status", "removedAt"],
        previousStatus: membership.status,
        newStatus: "REMOVED",
      });
    }

    return { status: "applied" };
  });
}

async function syncOrganizationEvent(
  client: PrismaClient,
  event: NormalizedOrganizationEvent,
  now: Date,
): Promise<ClerkSyncResult> {
  return runSerializable(client, async (transaction) => {
    const existing = await transaction.organization.findUnique({
      where: { clerkOrganizationId: event.clerkOrganizationId },
    });

    if (existing) {
      const decision = decideEventApplication({
        existingEventId: existing.lastWebhookEventId,
        existingUpdatedAt: existing.clerkUpdatedAt,
        incomingEventId: event.eventId,
        incomingUpdatedAt: event.updatedAt,
      });

      if (decision !== "applied") {
        return { status: decision };
      }

      if (existing.status === "ARCHIVED") {
        return { status: "stale" };
      }

      const fields = changedFields([
        ["name", existing.name !== event.name],
        ["slug", existing.slug !== event.slug],
        ["status", existing.status !== "ACTIVE"],
      ]);

      await releaseSlugFromArchivedOrganization(
        transaction,
        event.slug,
        event.clerkOrganizationId,
      );
      const organization = await transaction.organization.update({
        where: { id: existing.id },
        data: {
          name: event.name,
          slug: event.slug,
          status: "ACTIVE",
          archivedAt: null,
          clerkUpdatedAt: event.updatedAt,
          lastWebhookEventId: event.eventId,
          lastSyncedAt: now,
        },
      });

      if (fields.length > 0) {
        await createClerkSyncActivity(transaction, {
          organizationId: organization.id,
          action: "ORGANIZATION_UPDATED",
          targetType: "ORGANIZATION",
          targetId: organization.id,
          eventType: event.type,
          eventId: event.eventId,
          changedFields: fields,
          previousStatus: existing.status,
          newStatus: organization.status,
        });
      }

      return { status: "applied" };
    }

    await releaseSlugFromArchivedOrganization(
      transaction,
      event.slug,
      event.clerkOrganizationId,
    );
    const organization = await transaction.organization.create({
      data: {
        clerkOrganizationId: event.clerkOrganizationId,
        name: event.name,
        slug: event.slug,
        status: "ACTIVE",
        clerkUpdatedAt: event.updatedAt,
        lastWebhookEventId: event.eventId,
        lastSyncedAt: now,
      },
    });

    await createClerkSyncActivity(transaction, {
      organizationId: organization.id,
      action: "ORGANIZATION_UPDATED",
      targetType: "ORGANIZATION",
      targetId: organization.id,
      eventType: event.type,
      eventId: event.eventId,
      changedFields: ["name", "slug", "status"],
      previousStatus: null,
      newStatus: "ACTIVE",
    });

    return { status: "applied" };
  });
}

/**
 * Frees a slug still held by an archived organization.
 *
 * Deleting an organization in Clerk archives it here rather than removing it,
 * because its evidence and audit trail must outlive it -- but the archived row
 * kept its slug, and slugs are unique. Clerk releases the name the moment the
 * organization is deleted, so a person who deleted a workspace and recreated it
 * under the same name received a webhook carrying a slug the database refused.
 * The new workspace never arrived, the repair path failed on the same
 * constraint, and they were shown "this page couldn't load" with no way to tell
 * that the cause was a workspace they had deliberately removed.
 *
 * Only an archived holder is renamed. Archived organizations cannot be opened
 * by slug anyway, so nothing that works today changes. An active holder is a
 * genuine conflict between two live organizations, and that write is left to
 * fail rather than guessed at. The new slug embeds the row id, which guarantees
 * it is unique and says plainly why it changed.
 */
async function releaseSlugFromArchivedOrganization(
  transaction: Prisma.TransactionClient,
  slug: string,
  clerkOrganizationId: string,
): Promise<void> {
  const holder = await transaction.organization.findUnique({ where: { slug } });
  if (
    !holder ||
    holder.clerkOrganizationId === clerkOrganizationId ||
    holder.status !== "ARCHIVED"
  ) {
    return;
  }
  await transaction.organization.update({
    where: { id: holder.id },
    data: { slug: `${slug.slice(0, 50)}--archived-${holder.id}` },
  });
}

async function syncOrganizationDeletedEvent(
  client: PrismaClient,
  event: NormalizedOrganizationDeletedEvent,
  now: Date,
): Promise<ClerkSyncResult> {
  return runSerializable(client, async (transaction) => {
    const existing = await transaction.organization.findUnique({
      where: { clerkOrganizationId: event.clerkOrganizationId },
    });

    if (!existing) {
      return { status: "stale" };
    }
    if (existing.lastWebhookEventId === event.eventId) {
      return { status: "duplicate" };
    }

    if (
      existing.clerkUpdatedAt &&
      event.updatedAt.getTime() < existing.clerkUpdatedAt.getTime()
    ) {
      return { status: "stale" };
    }

    const wasArchived = existing.status === "ARCHIVED";
    const organization = await transaction.organization.update({
      where: { id: existing.id },
      data: {
        status: "ARCHIVED",
        archivedAt: existing.archivedAt ?? now,
        clerkUpdatedAt: event.updatedAt,
        lastWebhookEventId: event.eventId,
        lastSyncedAt: now,
      },
    });

    if (!wasArchived) {
      await createClerkSyncActivity(transaction, {
        organizationId: organization.id,
        action: "ORGANIZATION_UPDATED",
        targetType: "ORGANIZATION",
        targetId: organization.id,
        eventType: event.type,
        eventId: event.eventId,
        changedFields: ["status", "archivedAt"],
        previousStatus: existing.status,
        newStatus: "ARCHIVED",
      });
    }

    return { status: "applied" };
  });
}

async function ensureMembershipParents(
  transaction: Prisma.TransactionClient,
  event: NormalizedMembershipEvent,
  now: Date,
) {
  let organization = await transaction.organization.findUnique({
    where: { clerkOrganizationId: event.clerkOrganizationId },
  });

  if (!organization) {
    await releaseSlugFromArchivedOrganization(
      transaction,
      event.organization.slug,
      event.clerkOrganizationId,
    );
    organization = await transaction.organization.create({
      data: {
        clerkOrganizationId: event.clerkOrganizationId,
        name: event.organization.name,
        slug: event.organization.slug,
        status: "ACTIVE",
        clerkUpdatedAt: event.organization.updatedAt,
        lastSyncedAt: now,
      },
    });
  }

  let user = await transaction.user.findUnique({
    where: { clerkUserId: event.clerkUserId },
  });

  if (!user) {
    user = await transaction.user.create({
      data: {
        clerkUserId: event.clerkUserId,
        displayName: event.user.displayName,
        avatarUrl: event.user.avatarUrl,
        status: "ACTIVE",
        lastSyncedAt: now,
      },
    });
  }

  return { organization, user };
}

async function syncMembershipEvent(
  client: PrismaClient,
  event: NormalizedMembershipEvent,
  now: Date,
): Promise<ClerkSyncResult> {
  return runSerializable(client, async (transaction) => {
    if (event.type === "organizationMembership.deleted") {
      const organization = await transaction.organization.findUnique({
        where: { clerkOrganizationId: event.clerkOrganizationId },
      });
      const user = await transaction.user.findUnique({
        where: { clerkUserId: event.clerkUserId },
      });

      if (!organization || !user) {
        return { status: "stale" };
      }

      const byProviderId = await transaction.membership.findUnique({
        where: { clerkMembershipId: event.clerkMembershipId },
      });
      const existing = await transaction.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: organization.id,
            userId: user.id,
          },
        },
      });

      if (
        byProviderId &&
        (byProviderId.organizationId !== organization.id ||
          byProviderId.userId !== user.id)
      ) {
        throw new ClerkSyncConflictError();
      }

      if (!existing) {
        return { status: "stale" };
      }

      const decision = decideEventApplication({
        existingEventId: existing.lastWebhookEventId,
        existingUpdatedAt: existing.clerkUpdatedAt,
        incomingEventId: event.eventId,
        incomingUpdatedAt: event.updatedAt,
      });
      if (decision !== "applied") {
        return { status: decision };
      }

      const wasRemoved = existing.status === "REMOVED";
      await transaction.membership.update({
        where: { id: existing.id },
        data: {
          clerkMembershipId: event.clerkMembershipId,
          clerkRole: event.providerRole,
          status: "REMOVED",
          removedAt: existing.removedAt ?? now,
          clerkUpdatedAt: event.updatedAt,
          lastWebhookEventId: event.eventId,
          lastSyncedAt: now,
        },
      });

      if (!wasRemoved) {
        await createClerkSyncActivity(transaction, {
          organizationId: organization.id,
          action: "MEMBERSHIP_REMOVED",
          targetType: "MEMBERSHIP",
          targetId: existing.id,
          eventType: event.type,
          eventId: event.eventId,
          changedFields: ["status", "removedAt"],
          previousStatus: existing.status,
          newStatus: "REMOVED",
        });
      }

      return { status: "applied" };
    }

    const currentOrganization = await transaction.organization.findUnique({
      where: { clerkOrganizationId: event.clerkOrganizationId },
    });
    const currentUser = await transaction.user.findUnique({
      where: { clerkUserId: event.clerkUserId },
    });

    if (
      currentOrganization?.status === "ARCHIVED" ||
      currentUser?.status === "DELETED"
    ) {
      return { status: "stale" };
    }

    const { organization, user } = await ensureMembershipParents(
      transaction,
      event,
      now,
    );

    const byProviderId = await transaction.membership.findUnique({
      where: { clerkMembershipId: event.clerkMembershipId },
    });
    const existing = await transaction.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: organization.id,
          userId: user.id,
        },
      },
    });

    if (
      byProviderId &&
      (byProviderId.organizationId !== organization.id ||
        byProviderId.userId !== user.id)
    ) {
      throw new ClerkSyncConflictError();
    }

    if (existing && existing.clerkMembershipId) {
      if (
        existing.clerkMembershipId !== event.clerkMembershipId &&
        event.type !== "organizationMembership.created"
      ) {
        throw new ClerkSyncConflictError();
      }
    }

    if (existing) {
      const decision = decideEventApplication({
        existingEventId: existing.lastWebhookEventId,
        existingUpdatedAt: existing.clerkUpdatedAt,
        incomingEventId: event.eventId,
        incomingUpdatedAt: event.updatedAt,
      });
      if (decision !== "applied") {
        return { status: decision };
      }
    }

    const mappedRole = mapClerkOrganizationRole(event.providerRole);
    const activeOwnerCount = await transaction.membership.count({
      where: {
        organizationId: organization.id,
        role: "OWNER",
        status: "ACTIVE",
      },
    });
    const preserveOwner =
      existing?.role === "OWNER" && existing.status === "ACTIVE";
    const role = preserveOwner
      ? "OWNER"
      : shouldBootstrapOwner({
            creatorUserId: event.organization.creatorUserId,
            membershipUserId: event.clerkUserId,
            activeOwnerCount,
          })
        ? "OWNER"
        : mappedRole;

    const fields = existing
      ? changedFields([
          ["clerkMembershipId", existing.clerkMembershipId !== event.clerkMembershipId],
          ["clerkRole", existing.clerkRole !== event.providerRole],
          ["role", existing.role !== role],
          ["status", existing.status !== "ACTIVE"],
          ["removedAt", existing.removedAt !== null],
        ])
      : ["clerkMembershipId", "clerkRole", "role", "status"];

    const membership = existing
      ? await transaction.membership.update({
          where: { id: existing.id },
          data: {
            clerkMembershipId: event.clerkMembershipId,
            clerkRole: event.providerRole,
            role,
            status: "ACTIVE",
            removedAt: null,
            clerkUpdatedAt: event.updatedAt,
            lastWebhookEventId: event.eventId,
            lastSyncedAt: now,
          },
        })
      : await transaction.membership.create({
          data: {
            organizationId: organization.id,
            userId: user.id,
            clerkMembershipId: event.clerkMembershipId,
            clerkRole: event.providerRole,
            role,
            status: "ACTIVE",
            clerkUpdatedAt: event.updatedAt,
            lastWebhookEventId: event.eventId,
            lastSyncedAt: now,
          },
        });

    if (fields.length > 0) {
      await createClerkSyncActivity(transaction, {
        organizationId: organization.id,
        action: "MEMBERSHIP_ROLE_CHANGED",
        targetType: "MEMBERSHIP",
        targetId: membership.id,
        eventType: event.type,
        eventId: event.eventId,
        changedFields: fields,
        previousStatus: existing?.status ?? null,
        newStatus: membership.status,
      });
    }

    return { status: "applied" };
  });
}

async function dispatchNormalizedEvent(
  client: PrismaClient,
  event: NormalizedClerkWebhookEvent,
  now: Date,
): Promise<ClerkSyncResult> {
  if (event.kind === "user") {
    return syncUserEvent(client, event, now);
  }
  if (event.kind === "user.deleted") {
    return syncUserDeletedEvent(client, event, now);
  }
  if (event.kind === "organization") {
    return syncOrganizationEvent(client, event, now);
  }
  if (event.kind === "organization.deleted") {
    return syncOrganizationDeletedEvent(client, event, now);
  }
  return syncMembershipEvent(client, event, now);
}

export async function dispatchClerkWebhook(input: {
  type: unknown;
  data: unknown;
  eventId: string;
  eventTimestamp?: unknown;
  prisma?: PrismaClient;
  now?: Date;
}): Promise<ClerkSyncResult> {
  const parsed = parseVerifiedClerkWebhook(input);
  if (parsed.kind === "ignored") {
    return { status: "ignored" };
  }

  return dispatchNormalizedEvent(
    input.prisma ?? getPrismaClient(),
    parsed.event,
    input.now ?? new Date(),
  );
}

export type ClerkReconciliationSnapshot = {
  organization: {
    id: string;
    name: string;
    slug: string;
    createdBy: string | null;
    updatedAt: Date;
  };
  users: ReadonlyArray<{
    id: string;
    primaryEmail: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    disabled: boolean;
    updatedAt: Date;
  }>;
  memberships: ReadonlyArray<{
    id: string;
    organizationId: string;
    userId: string;
    role: string;
    updatedAt: Date;
  }>;
};

export type ClerkReconciliationResult = {
  status: "dry-run" | "applied";
  organizationId: string;
  counts: {
    organizationsToSync: number;
    usersToSync: number;
    membershipsToSync: number;
    membershipsToRemove: number;
  };
};

function sameDate(left: Date | null, right: Date): boolean {
  return left?.getTime() === right.getTime();
}

export async function reconcileClerkOrganizationSnapshot(input: {
  snapshot: ClerkReconciliationSnapshot;
  apply?: boolean;
  prisma?: PrismaClient;
  now?: Date;
}): Promise<ClerkReconciliationResult> {
  const client = input.prisma ?? getPrismaClient();
  const now = input.now ?? new Date();
  const snapshot = input.snapshot;

  if (
    snapshot.memberships.some(
      (membership) =>
        membership.organizationId !== snapshot.organization.id,
    )
  ) {
    throw new ClerkSyncConflictError(
      "The reconciliation snapshot crosses organization boundaries.",
    );
  }

  const providerUserIds = new Set(snapshot.users.map((user) => user.id));
  if (
    snapshot.memberships.some(
      (membership) => !providerUserIds.has(membership.userId),
    )
  ) {
    throw new ClerkSyncConflictError(
      "The reconciliation snapshot is missing a membership user.",
    );
  }

  const localOrganization = await client.organization.findUnique({
    where: { clerkOrganizationId: snapshot.organization.id },
    include: {
      memberships: {
        include: { user: true },
      },
    },
  });
  const localUsers = await client.user.findMany({
    where: { clerkUserId: { in: [...providerUserIds] } },
  });
  const localUserByClerkId = new Map(
    localUsers.map((user) => [user.clerkUserId, user]),
  );
  const providerMembershipIds = new Set(
    snapshot.memberships.map((membership) => membership.id),
  );
  const providerMembershipUserIds = new Set(
    snapshot.memberships.map((membership) => membership.userId),
  );

  const organizationsToSync =
    !localOrganization ||
    localOrganization.name !== snapshot.organization.name ||
    localOrganization.slug !== snapshot.organization.slug ||
    localOrganization.status !== "ACTIVE" ||
    !sameDate(
      localOrganization.clerkUpdatedAt,
      snapshot.organization.updatedAt,
    )
      ? 1
      : 0;
  const usersToSync = snapshot.users.filter((providerUser) => {
    const localUser = localUserByClerkId.get(providerUser.id);
    return (
      !localUser ||
      localUser.primaryEmail !== providerUser.primaryEmail ||
      localUser.displayName !== providerUser.displayName ||
      localUser.avatarUrl !== providerUser.avatarUrl ||
      localUser.status !== (providerUser.disabled ? "DISABLED" : "ACTIVE") ||
      !sameDate(localUser.clerkUpdatedAt, providerUser.updatedAt)
    );
  }).length;
  const localMembershipByUserId = new Map(
    localOrganization?.memberships.map((membership) => [
      membership.user.clerkUserId,
      membership,
    ]) ?? [],
  );
  const membershipsToSync = snapshot.memberships.filter(
    (providerMembership) => {
      const localMembership = localMembershipByUserId.get(
        providerMembership.userId,
      );
      if (!localMembership) {
        return true;
      }
      const mappedRole = mapClerkOrganizationRole(providerMembership.role);
      const expectedRole =
        localMembership.role === "OWNER" &&
        localMembership.status === "ACTIVE"
          ? "OWNER"
          : providerMembership.userId === snapshot.organization.createdBy &&
              !localOrganization?.memberships.some(
                (membership) =>
                  membership.role === "OWNER" &&
                  membership.status === "ACTIVE",
              )
            ? "OWNER"
            : mappedRole;
      return (
        localMembership.clerkMembershipId !== providerMembership.id ||
        localMembership.clerkRole !== providerMembership.role ||
        localMembership.role !== expectedRole ||
        localMembership.status !== "ACTIVE" ||
        !sameDate(
          localMembership.clerkUpdatedAt,
          providerMembership.updatedAt,
        )
      );
    },
  ).length;
  const membershipsToRemove =
    localOrganization?.memberships.filter(
      (membership) =>
        membership.status !== "REMOVED" &&
        !providerMembershipUserIds.has(membership.user.clerkUserId),
    ).length ?? 0;

  const result: ClerkReconciliationResult = {
    status: input.apply ? "applied" : "dry-run",
    organizationId: snapshot.organization.id,
    counts: {
      organizationsToSync,
      usersToSync,
      membershipsToSync,
      membershipsToRemove,
    },
  };

  if (!input.apply) {
    return result;
  }

  await runSerializable(client, async (transaction) => {
    const previousOrganization = await transaction.organization.findUnique({
      where: { clerkOrganizationId: snapshot.organization.id },
    });
    await releaseSlugFromArchivedOrganization(
      transaction,
      snapshot.organization.slug,
      snapshot.organization.id,
    );
    const organization = await transaction.organization.upsert({
      where: { clerkOrganizationId: snapshot.organization.id },
      create: {
        clerkOrganizationId: snapshot.organization.id,
        name: snapshot.organization.name,
        slug: snapshot.organization.slug,
        status: "ACTIVE",
        clerkUpdatedAt: snapshot.organization.updatedAt,
        lastSyncedAt: now,
      },
      update: {
        name: snapshot.organization.name,
        slug: snapshot.organization.slug,
        status: "ACTIVE",
        archivedAt: null,
        clerkUpdatedAt: snapshot.organization.updatedAt,
        lastSyncedAt: now,
      },
    });

    if (organizationsToSync > 0) {
      await createClerkSyncActivity(transaction, {
        organizationId: organization.id,
        action: "ORGANIZATION_UPDATED",
        targetType: "ORGANIZATION",
        targetId: organization.id,
        eventType: "reconciliation",
        changedFields: ["name", "slug", "status"],
        previousStatus: previousOrganization?.status ?? null,
        newStatus: "ACTIVE",
        source: "SYSTEM",
      });
    }

    const localUserIds = new Map<string, string>();
    for (const providerUser of snapshot.users) {
      const user = await transaction.user.upsert({
        where: { clerkUserId: providerUser.id },
        create: {
          clerkUserId: providerUser.id,
          primaryEmail: providerUser.primaryEmail,
          displayName: providerUser.displayName,
          avatarUrl: providerUser.avatarUrl,
          status: providerUser.disabled ? "DISABLED" : "ACTIVE",
          disabledAt: providerUser.disabled ? now : null,
          clerkUpdatedAt: providerUser.updatedAt,
          lastSyncedAt: now,
        },
        update: {
          primaryEmail: providerUser.primaryEmail,
          displayName: providerUser.displayName,
          avatarUrl: providerUser.avatarUrl,
          status: providerUser.disabled ? "DISABLED" : "ACTIVE",
          disabledAt: providerUser.disabled ? now : null,
          deletedAt: null,
          clerkUpdatedAt: providerUser.updatedAt,
          lastSyncedAt: now,
        },
      });
      localUserIds.set(providerUser.id, user.id);
    }

    const orderedMemberships = [...snapshot.memberships].sort((left, right) => {
      if (left.userId === snapshot.organization.createdBy) return -1;
      if (right.userId === snapshot.organization.createdBy) return 1;
      return left.id.localeCompare(right.id);
    });

    for (const providerMembership of orderedMemberships) {
      const localUserId = localUserIds.get(providerMembership.userId);
      if (!localUserId) {
        throw new ClerkSyncConflictError();
      }

      const existing = await transaction.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: organization.id,
            userId: localUserId,
          },
        },
      });
      const providerIdOwner = await transaction.membership.findUnique({
        where: { clerkMembershipId: providerMembership.id },
      });
      if (
        providerIdOwner &&
        (providerIdOwner.organizationId !== organization.id ||
          providerIdOwner.userId !== localUserId)
      ) {
        throw new ClerkSyncConflictError();
      }

      const activeOwnerCount = await transaction.membership.count({
        where: {
          organizationId: organization.id,
          role: "OWNER",
          status: "ACTIVE",
        },
      });
      const role =
        existing?.role === "OWNER" && existing.status === "ACTIVE"
          ? "OWNER"
          : shouldBootstrapOwner({
                creatorUserId: snapshot.organization.createdBy,
                membershipUserId: providerMembership.userId,
                activeOwnerCount,
              })
            ? "OWNER"
            : mapClerkOrganizationRole(providerMembership.role);
      const membership = existing
        ? await transaction.membership.update({
            where: { id: existing.id },
            data: {
              clerkMembershipId: providerMembership.id,
              clerkRole: providerMembership.role,
              role,
              status: "ACTIVE",
              removedAt: null,
              clerkUpdatedAt: providerMembership.updatedAt,
              lastSyncedAt: now,
            },
          })
        : await transaction.membership.create({
            data: {
              organizationId: organization.id,
              userId: localUserId,
              clerkMembershipId: providerMembership.id,
              clerkRole: providerMembership.role,
              role,
              status: "ACTIVE",
              clerkUpdatedAt: providerMembership.updatedAt,
              lastSyncedAt: now,
            },
          });

      const fields = existing
        ? changedFields([
            ["clerkMembershipId", existing.clerkMembershipId !== providerMembership.id],
            ["clerkRole", existing.clerkRole !== providerMembership.role],
            ["role", existing.role !== role],
            ["status", existing.status !== "ACTIVE"],
          ])
        : ["clerkMembershipId", "clerkRole", "role", "status"];
      if (fields.length > 0) {
        await createClerkSyncActivity(transaction, {
          organizationId: organization.id,
          action: "MEMBERSHIP_ROLE_CHANGED",
          targetType: "MEMBERSHIP",
          targetId: membership.id,
          eventType: "reconciliation",
          changedFields: fields,
          previousStatus: existing?.status ?? null,
          newStatus: "ACTIVE",
          source: "SYSTEM",
        });
      }
    }

    const localMemberships = await transaction.membership.findMany({
      where: {
        organizationId: organization.id,
        status: { not: "REMOVED" },
      },
    });
    for (const membership of localMemberships) {
      if (
        membership.clerkMembershipId &&
        providerMembershipIds.has(membership.clerkMembershipId)
      ) {
        continue;
      }
      await transaction.membership.update({
        where: { id: membership.id },
        data: {
          status: "REMOVED",
          removedAt: now,
          lastSyncedAt: now,
        },
      });
      await createClerkSyncActivity(transaction, {
        organizationId: organization.id,
        action: "MEMBERSHIP_REMOVED",
        targetType: "MEMBERSHIP",
        targetId: membership.id,
        eventType: "reconciliation",
        changedFields: ["status", "removedAt"],
        previousStatus: membership.status,
        newStatus: "REMOVED",
        source: "SYSTEM",
      });
    }
  });

  return result;
}
