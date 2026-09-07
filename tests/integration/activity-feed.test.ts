import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { groupActivityByDay, listProjectActivity } from "@/lib/services/activity-feed";
import {
  approveRequirement,
  createRequirement,
  submitRequirementForReview,
} from "@/lib/services/requirements";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

describe("project activity feed", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await connectTestDatabase(prisma);
  });
  beforeEach(async () => cleanPhase1ATables(prisma));
  afterAll(async () => {
    if (prisma) {
      await cleanPhase1ATables(prisma);
      await disconnectTestDatabase(prisma);
    }
  });

  async function workspace() {
    const owner = await prisma.user.create({
      data: { clerkUserId: unique("owner"), displayName: "Owner" },
    });
    const organization = await prisma.organization.create({
      data: {
        clerkOrganizationId: unique("org"),
        name: "Feed workspace",
        slug: unique("feed"),
      },
    });
    await prisma.membership.create({
      data: { organizationId: organization.id, userId: owner.id, role: "OWNER" },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: organization.id,
        name: "Checkout",
        slug: unique("checkout"),
        createdByUserId: owner.id,
      },
    });
    return { owner, organization, project };
  }

  const deps = (space: Awaited<ReturnType<typeof workspace>>) => ({
    authenticate: async () => ({
      userId: space.owner.clerkUserId,
      orgId: space.organization.clerkOrganizationId,
    }),
    prisma,
  });

  it("reports what happened, newest first, in plain language", async () => {
    const space = await workspace();
    const requirement = await createRequirement({
      projectId: space.project.id,
      title: "Customers can pay by card",
      description: "A signed-in customer can pay with a valid card.",
      acceptanceCriteria: "A valid card produces an order confirmation.",
    }, deps(space));
    await submitRequirementForReview({
      projectId: space.project.id, requirementId: requirement.id,
    }, deps(space));
    await approveRequirement({
      projectId: space.project.id, requirementId: requirement.id,
    }, deps(space));

    const feed = await listProjectActivity({ projectId: space.project.id }, deps(space));

    expect(feed.items.length).toBeGreaterThanOrEqual(3);
    expect(feed.items[0].summary).toBe("approved a requirement");
    // Enum names are a log file; sentences are what a colleague did.
    expect(feed.items.every((entry) => /^[a-z]/.test(entry.summary))).toBe(true);
    expect(feed.items[0].actorName).toBe("Owner");
  });

  it("links only to targets that have a page", async () => {
    const space = await workspace();
    const requirement = await createRequirement({
      projectId: space.project.id,
      title: "Customers can pay by card",
      description: "d",
      acceptanceCriteria: "a",
    }, deps(space));

    const feed = await listProjectActivity({ projectId: space.project.id }, deps(space));
    const created = feed.items.find((entry) => entry.action === "REQUIREMENT_CREATED");

    expect(created?.href).toContain(`/requirements/${requirement.id}`);
    // A row that looks clickable and goes nowhere teaches people to stop
    // clicking, so targets without a page carry no link at all.
    const unlinkable = feed.items.filter(
      (entry) => entry.targetType === "REQUIREMENT_TEST_CASE",
    );
    expect(unlinkable.every((entry) => entry.href === null)).toBe(true);
  });

  it("does not show another project's activity", async () => {
    const space = await workspace();
    const other = await prisma.project.create({
      data: {
        organizationId: space.organization.id,
        name: "Billing",
        slug: unique("billing"),
        createdByUserId: space.owner.id,
      },
    });
    await createRequirement({
      projectId: space.project.id,
      title: "Scoped to one project",
      description: "d",
      acceptanceCriteria: "a",
    }, deps(space));

    const feed = await listProjectActivity({ projectId: other.id }, deps(space));

    expect(feed.items.every((entry) => entry.action !== "REQUIREMENT_CREATED")).toBe(true);
  });

  it("pages rather than loading an audit trail that only grows", async () => {
    const space = await workspace();
    for (let index = 0; index < 3; index += 1) {
      await createRequirement({
        projectId: space.project.id,
        title: `Requirement ${index}`,
        description: "d",
        acceptanceCriteria: "a",
      }, deps(space));
    }

    const feed = await listProjectActivity(
      { projectId: space.project.id, pageSize: 2 },
      deps(space),
    );

    expect(feed.items).toHaveLength(2);
    expect(feed.total).toBeGreaterThanOrEqual(3);
  });
});

describe("grouping activity by day", () => {
  const entry = (id: string, iso: string) => ({
    id,
    action: "REQUIREMENT_APPROVED" as const,
    targetType: "REQUIREMENT" as const,
    targetId: "t",
    actorName: "Owner",
    createdAt: new Date(iso),
    summary: "approved a requirement",
    href: null,
  });

  it("keeps one group per calendar day, in the order given", () => {
    const groups = groupActivityByDay([
      entry("a", "2026-09-07T10:00:00Z"),
      entry("b", "2026-09-07T09:00:00Z"),
      entry("c", "2026-09-06T18:00:00Z"),
    ]);

    expect(groups.map((group) => group.day)).toEqual(["2026-09-07", "2026-09-06"]);
    expect(groups[0].entries).toHaveLength(2);
    expect(groups[1].entries).toHaveLength(1);
  });

  it("returns nothing for an empty feed", () => {
    expect(groupActivityByDay([])).toEqual([]);
  });
});
