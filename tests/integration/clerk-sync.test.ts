import { randomUUID } from "node:crypto";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  dispatchClerkWebhook,
  reconcileClerkOrganizationSnapshot,
} from "@/lib/services/clerk-sync";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";
import {
  clerkMembershipData,
  clerkOrganizationData,
  clerkUserData,
} from "@/tests/helpers/clerk";

function uniqueValue(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

describe("Clerk to PostgreSQL synchronization", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await connectTestDatabase(prisma);
  });

  beforeEach(async () => {
    await cleanPhase1ATables(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await cleanPhase1ATables(prisma);
      await disconnectTestDatabase(prisma);
    }
  });

  async function synchronize(
    type: string,
    data: unknown,
    eventId = uniqueValue("event"),
    eventTimestamp = 1_700_000_000_000,
  ) {
    return dispatchClerkWebhook({
      type,
      data,
      eventId,
      eventTimestamp,
      prisma,
      now: new Date(1_800_000_000_000),
    });
  }

  it("creates one User for user.created", async () => {
    const clerkUserId = uniqueValue("user");
    await synchronize("user.created", clerkUserData({ id: clerkUserId }));

    expect(await prisma.user.count({ where: { clerkUserId } })).toBe(1);
  });

  it("does not duplicate a User on replay", async () => {
    const clerkUserId = uniqueValue("user");
    const eventId = uniqueValue("event");
    const data = clerkUserData({ id: clerkUserId });

    expect((await synchronize("user.created", data, eventId)).status).toBe(
      "applied",
    );
    expect((await synchronize("user.created", data, eventId)).status).toBe(
      "duplicate",
    );
    expect(await prisma.user.count({ where: { clerkUserId } })).toBe(1);
  });

  it("does not let an older user.updated overwrite newer data", async () => {
    const clerkUserId = uniqueValue("user");
    await synchronize(
      "user.updated",
      clerkUserData({
        id: clerkUserId,
        firstName: "Newer",
        updatedAt: 3000,
      }),
    );
    const result = await synchronize(
      "user.updated",
      clerkUserData({
        id: clerkUserId,
        firstName: "Older",
        updatedAt: 2000,
      }),
    );

    expect(result.status).toBe("stale");
    expect(
      (await prisma.user.findUniqueOrThrow({
        where: { clerkUserId },
      })).displayName,
    ).toBe("Newer User");
  });

  it("soft-deletes a User", async () => {
    const clerkUserId = uniqueValue("user");
    await synchronize("user.created", clerkUserData({ id: clerkUserId }));
    await synchronize("user.deleted", { id: clerkUserId, deleted: true });

    const user = await prisma.user.findUniqueOrThrow({
      where: { clerkUserId },
    });
    expect(user.status).toBe("DELETED");
    expect(user.deletedAt).not.toBeNull();
  });

  it("does not let an older user.deleted override a newer User", async () => {
    const clerkUserId = uniqueValue("user");
    await synchronize(
      "user.updated",
      clerkUserData({ id: clerkUserId, updatedAt: 3000 }),
    );

    const result = await synchronize(
      "user.deleted",
      { id: clerkUserId, deleted: true },
      uniqueValue("event"),
      2000,
    );

    expect(result.status).toBe("stale");
    expect(
      (await prisma.user.findUniqueOrThrow({
        where: { clerkUserId },
      })).status,
    ).toBe("ACTIVE");
  });

  it("removes active Membership access when a User is deleted", async () => {
    const clerkUserId = uniqueValue("user");
    const clerkOrganizationId = uniqueValue("org");
    await synchronize(
      "organizationMembership.created",
      clerkMembershipData({
        userId: clerkUserId,
        organization: {
          id: clerkOrganizationId,
          slug: uniqueValue("slug"),
          creatorUserId: clerkUserId,
        },
      }),
    );
    await synchronize("user.deleted", { id: clerkUserId, deleted: true });

    const membership = await prisma.membership.findFirstOrThrow({
      where: {
        organization: { clerkOrganizationId },
        user: { clerkUserId },
      },
    });
    expect(membership.status).toBe("REMOVED");
    expect(membership.removedAt).not.toBeNull();
  });

  it("creates one Organization for organization.created", async () => {
    const clerkOrganizationId = uniqueValue("org");
    await synchronize(
      "organization.created",
      clerkOrganizationData({
        id: clerkOrganizationId,
        slug: uniqueValue("slug"),
      }),
    );

    expect(
      await prisma.organization.count({
        where: { clerkOrganizationId },
      }),
    ).toBe(1);
  });

  it("keeps organization.created idempotent", async () => {
    const clerkOrganizationId = uniqueValue("org");
    const eventId = uniqueValue("event");
    const data = clerkOrganizationData({
      id: clerkOrganizationId,
      slug: uniqueValue("slug"),
    });

    await synchronize("organization.created", data, eventId);
    expect(
      (await synchronize("organization.created", data, eventId)).status,
    ).toBe("duplicate");
    expect(
      await prisma.organization.count({
        where: { clerkOrganizationId },
      }),
    ).toBe(1);
  });

  it("updates Organization fields only from a newer event", async () => {
    const clerkOrganizationId = uniqueValue("org");
    const originalSlug = uniqueValue("slug");
    const newerSlug = uniqueValue("slug");
    await synchronize(
      "organization.created",
      clerkOrganizationData({
        id: clerkOrganizationId,
        name: "Original",
        slug: originalSlug,
        updatedAt: 1000,
      }),
    );
    await synchronize(
      "organization.updated",
      clerkOrganizationData({
        id: clerkOrganizationId,
        name: "Newer",
        slug: newerSlug,
        updatedAt: 3000,
      }),
    );
    const staleResult = await synchronize(
      "organization.updated",
      clerkOrganizationData({
        id: clerkOrganizationId,
        name: "Older",
        slug: originalSlug,
        updatedAt: 2000,
      }),
    );

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { clerkOrganizationId },
    });
    expect(staleResult.status).toBe("stale");
    expect(organization.name).toBe("Newer");
    expect(organization.slug).toBe(newerSlug);
  });

  it("archives an Organization without hard deletion", async () => {
    const clerkOrganizationId = uniqueValue("org");
    await synchronize(
      "organization.created",
      clerkOrganizationData({
        id: clerkOrganizationId,
        slug: uniqueValue("slug"),
      }),
    );
    await synchronize("organization.deleted", {
      id: clerkOrganizationId,
      deleted: true,
    });

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { clerkOrganizationId },
    });
    expect(organization.status).toBe("ARCHIVED");
    expect(organization.archivedAt).not.toBeNull();
  });

  it("lets a deleted workspace's name be used again", async () => {
    // Deleting an organization archives it here, but its slug stayed taken.
    // Clerk frees the name immediately, so recreating a workspace under the
    // same name produced a webhook the database refused -- and the person was
    // left on "this page couldn't load" because of a workspace they had
    // deliberately removed.
    const slug = uniqueValue("mamuti-sdet");
    const firstId = uniqueValue("org");
    const secondId = uniqueValue("org");

    await synchronize("organization.created", clerkOrganizationData({ id: firstId, slug }));
    await synchronize("organization.deleted", { id: firstId, deleted: true });

    const result = await synchronize(
      "organization.created",
      clerkOrganizationData({ id: secondId, slug }),
    );

    expect(result.status).toBe("applied");
    const recreated = await prisma.organization.findUniqueOrThrow({
      where: { clerkOrganizationId: secondId },
    });
    expect(recreated.slug).toBe(slug);
    expect(recreated.status).toBe("ACTIVE");

    // The archived workspace keeps its row, its evidence and its history; only
    // the name moved aside, in a form that says why.
    const archived = await prisma.organization.findUniqueOrThrow({
      where: { clerkOrganizationId: firstId },
    });
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.slug).toContain("--archived-");
    expect(archived.slug).not.toBe(slug);
  });

  it("still refuses a slug held by another live organization", async () => {
    // Two active organizations with one slug is a real conflict, not something
    // to resolve by renaming whichever arrived first.
    const slug = uniqueValue("taken");
    await synchronize(
      "organization.created",
      clerkOrganizationData({ id: uniqueValue("org"), slug }),
    );

    await expect(
      synchronize(
        "organization.created",
        clerkOrganizationData({ id: uniqueValue("org"), slug }),
      ),
    ).rejects.toThrow();
  });

  it("does not let an older organization.deleted archive newer state", async () => {
    const clerkOrganizationId = uniqueValue("org");
    await synchronize(
      "organization.updated",
      clerkOrganizationData({
        id: clerkOrganizationId,
        slug: uniqueValue("slug"),
        updatedAt: 3000,
      }),
    );

    const result = await synchronize(
      "organization.deleted",
      { id: clerkOrganizationId, deleted: true },
      uniqueValue("event"),
      2000,
    );

    expect(result.status).toBe("stale");
    expect(
      (await prisma.organization.findUniqueOrThrow({
        where: { clerkOrganizationId },
      })).status,
    ).toBe("ACTIVE");
  });

  it("creates one Membership", async () => {
    const clerkMembershipId = uniqueValue("membership");
    await synchronize(
      "organizationMembership.created",
      clerkMembershipData({
        id: clerkMembershipId,
        userId: uniqueValue("user"),
        organization: {
          id: uniqueValue("org"),
          slug: uniqueValue("slug"),
        },
      }),
    );

    expect(
      await prisma.membership.count({ where: { clerkMembershipId } }),
    ).toBe(1);
  });

  it("does not duplicate a Membership on replay", async () => {
    const clerkMembershipId = uniqueValue("membership");
    const eventId = uniqueValue("event");
    const data = clerkMembershipData({
      id: clerkMembershipId,
      userId: uniqueValue("user"),
      organization: {
        id: uniqueValue("org"),
        slug: uniqueValue("slug"),
      },
    });
    await synchronize("organizationMembership.created", data, eventId);
    expect(
      (
        await synchronize(
          "organizationMembership.created",
          data,
          eventId,
        )
      ).status,
    ).toBe("duplicate");
    expect(
      await prisma.membership.count({ where: { clerkMembershipId } }),
    ).toBe(1);
  });

  it("marks a deleted Membership as REMOVED", async () => {
    const data = clerkMembershipData({
      id: uniqueValue("membership"),
      userId: uniqueValue("user"),
      updatedAt: 1000,
      organization: {
        id: uniqueValue("org"),
        slug: uniqueValue("slug"),
      },
    });
    await synchronize("organizationMembership.created", data);
    await synchronize("organizationMembership.deleted", {
      ...data,
      updated_at: 2000,
    });

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { clerkMembershipId: data.id },
    });
    expect(membership.status).toBe("REMOVED");
  });

  it("reactivates the same organization and user Membership row", async () => {
    const userId = uniqueValue("user");
    const organization = {
      id: uniqueValue("org"),
      slug: uniqueValue("slug"),
      creatorUserId: userId,
    };
    const original = clerkMembershipData({
      id: uniqueValue("membership"),
      userId,
      updatedAt: 1000,
      organization,
    });
    await synchronize("organizationMembership.created", original);
    const localBefore = await prisma.membership.findUniqueOrThrow({
      where: { clerkMembershipId: original.id },
    });
    await synchronize("organizationMembership.deleted", {
      ...original,
      updated_at: 2000,
    });
    const readded = clerkMembershipData({
      id: uniqueValue("membership"),
      userId,
      updatedAt: 3000,
      organization,
    });
    await synchronize("organizationMembership.created", readded);

    const localAfter = await prisma.membership.findUniqueOrThrow({
      where: { clerkMembershipId: readded.id },
    });
    expect(localAfter.id).toBe(localBefore.id);
    expect(localAfter.status).toBe("ACTIVE");
  });

  it("does not reactivate removal from a stale Membership update", async () => {
    const data = clerkMembershipData({
      id: uniqueValue("membership"),
      userId: uniqueValue("user"),
      updatedAt: 1000,
      organization: {
        id: uniqueValue("org"),
        slug: uniqueValue("slug"),
      },
    });
    await synchronize("organizationMembership.created", data);
    await synchronize("organizationMembership.deleted", {
      ...data,
      updated_at: 3000,
    });
    const result = await synchronize("organizationMembership.updated", {
      ...data,
      updated_at: 2000,
    });

    expect(result.status).toBe("stale");
    expect(
      (await prisma.membership.findUniqueOrThrow({
        where: { clerkMembershipId: data.id },
      })).status,
    ).toBe("REMOVED");
  });

  it("does not downgrade an existing OWNER on a generic admin update", async () => {
    const userId = uniqueValue("user");
    const data = clerkMembershipData({
      id: uniqueValue("membership"),
      userId,
      role: "org:admin",
      updatedAt: 1000,
      organization: {
        id: uniqueValue("org"),
        slug: uniqueValue("slug"),
        creatorUserId: userId,
      },
    });
    await synchronize("organizationMembership.created", data);
    await synchronize("organizationMembership.updated", {
      ...data,
      updated_at: 2000,
    });

    expect(
      (await prisma.membership.findUniqueOrThrow({
        where: { clerkMembershipId: data.id },
      })).role,
    ).toBe("OWNER");
  });

  it("bootstraps exactly one OWNER from verified creator evidence", async () => {
    const creatorUserId = uniqueValue("user");
    const organization = {
      id: uniqueValue("org"),
      slug: uniqueValue("slug"),
      creatorUserId,
    };
    await synchronize(
      "organizationMembership.created",
      clerkMembershipData({
        id: uniqueValue("membership"),
        userId: creatorUserId,
        role: "org:admin",
        organization,
      }),
    );
    await synchronize(
      "organizationMembership.created",
      clerkMembershipData({
        id: uniqueValue("membership"),
        userId: uniqueValue("user"),
        role: "org:admin",
        organization,
      }),
    );

    const localOrganization = await prisma.organization.findUniqueOrThrow({
      where: { clerkOrganizationId: organization.id },
    });
    expect(
      await prisma.membership.count({
        where: {
          organizationId: localOrganization.id,
          role: "OWNER",
          status: "ACTIVE",
        },
      }),
    ).toBe(1);
  });

  it("does not create duplicate Activity on event replay", async () => {
    const data = clerkMembershipData({
      id: uniqueValue("membership"),
      userId: uniqueValue("user"),
      organization: {
        id: uniqueValue("org"),
        slug: uniqueValue("slug"),
      },
    });
    const eventId = uniqueValue("event");
    await synchronize("organizationMembership.created", data, eventId);
    const countBefore = await prisma.activity.count();
    await synchronize("organizationMembership.created", data, eventId);

    expect(await prisma.activity.count()).toBe(countBefore);
  });

  it("writes exactly one Activity for effective Membership removal", async () => {
    const data = clerkMembershipData({
      id: uniqueValue("membership"),
      userId: uniqueValue("user"),
      updatedAt: 1000,
      organization: {
        id: uniqueValue("org"),
        slug: uniqueValue("slug"),
      },
    });
    await synchronize("organizationMembership.created", data);
    const removalEventId = uniqueValue("event");
    await synchronize(
      "organizationMembership.deleted",
      { ...data, updated_at: 2000 },
      removalEventId,
    );
    await synchronize(
      "organizationMembership.deleted",
      { ...data, updated_at: 2000 },
      removalEventId,
    );

    expect(
      await prisma.activity.count({
        where: {
          action: "MEMBERSHIP_REMOVED",
          requestId: removalEventId,
        },
      }),
    ).toBe(1);
  });

  it("rolls back parent creation when a Membership transaction fails", async () => {
    const first = clerkMembershipData({
      id: uniqueValue("membership"),
      userId: uniqueValue("user"),
      organization: {
        id: uniqueValue("org"),
        slug: uniqueValue("slug"),
      },
    });
    await synchronize("organizationMembership.created", first);

    const secondUserId = uniqueValue("user");
    const secondOrganizationId = uniqueValue("org");
    await expect(
      synchronize(
        "organizationMembership.created",
        clerkMembershipData({
          id: first.id,
          userId: secondUserId,
          organization: {
            id: secondOrganizationId,
            slug: uniqueValue("slug"),
          },
        }),
      ),
    ).rejects.toThrow();

    expect(
      await prisma.user.findUnique({ where: { clerkUserId: secondUserId } }),
    ).toBeNull();
    expect(
      await prisma.organization.findUnique({
        where: { clerkOrganizationId: secondOrganizationId },
      }),
    ).toBeNull();
  });

  it("rejects a cross-organization provider Membership identity", async () => {
    const clerkMembershipId = uniqueValue("membership");
    const first = clerkMembershipData({
      id: clerkMembershipId,
      userId: uniqueValue("user"),
      organization: {
        id: uniqueValue("org"),
        slug: uniqueValue("slug"),
      },
    });
    await synchronize("organizationMembership.created", first);

    await expect(
      synchronize(
        "organizationMembership.created",
        clerkMembershipData({
          id: clerkMembershipId,
          userId: uniqueValue("user"),
          organization: {
            id: uniqueValue("org"),
            slug: uniqueValue("slug"),
          },
        }),
      ),
    ).rejects.toThrow();
    expect(
      await prisma.membership.count({ where: { clerkMembershipId } }),
    ).toBe(1);
  });

  it("keeps reconciliation dry-run free of database writes", async () => {
    const clerkOrganizationId = uniqueValue("org");
    const result = await reconcileClerkOrganizationSnapshot({
      prisma,
      snapshot: {
        organization: {
          id: clerkOrganizationId,
          name: "Dry run organization",
          slug: uniqueValue("slug"),
          createdBy: null,
          updatedAt: new Date(1_700_000_000_000),
        },
        users: [],
        memberships: [],
      },
    });

    expect(result.status).toBe("dry-run");
    expect(result.counts.organizationsToSync).toBe(1);
    expect(
      await prisma.organization.findUnique({
        where: { clerkOrganizationId },
      }),
    ).toBeNull();
  });
});
