import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient, TestCaseStatus } from "@/generated/prisma/client";
import { PICKER_PAGE_SIZE } from "@/lib/services/list-query";
import { listRequirements } from "@/lib/services/requirements";
import { listTestCases } from "@/lib/services/test-cases";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

/**
 * Whether a project's hundred-and-first requirement can be reached at all.
 *
 * Three pickers rendered a page of options ordered by what changed most
 * recently, with no search and nothing saying anything had been left out. Past
 * the cap, a requirement could not be linked and an approved test case could
 * not be run, and the page looked exactly as it does when they do not exist.
 */
describe("reaching past the first page of a picker", () => {
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
      data: { clerkOrganizationId: unique("org"), name: "Shop", slug: unique("shop") },
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

  async function addTestCase(
    space: Awaited<ReturnType<typeof workspace>>,
    title: string,
    status: TestCaseStatus,
  ) {
    return prisma.testCase.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        title,
        objective: "Checks something.",
        preconditions: "",
        steps: ["Do it"],
        expectedResults: ["It worked"],
        status,
        ownerUserId: space.owner.id,
        createdByUserId: space.owner.id,
        currentVersionNumber: 1,
      },
    });
  }

  async function addRequirement(
    space: Awaited<ReturnType<typeof workspace>>,
    title: string,
  ) {
    return prisma.requirement.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        title,
        description: "Something the product must do.",
        acceptanceCriteria: "It does it.",
        status: "APPROVED",
        ownerUserId: space.owner.id,
        createdByUserId: space.owner.id,
        currentVersionNumber: 1,
      },
    });
  }

  it("finds an approved test case buried under newer drafts", async () => {
    const space = await workspace();
    // The one that matters, created first so everything else is newer.
    const approved = await addTestCase(space, "Customer completes checkout", "APPROVED");
    for (let index = 0; index < PICKER_PAGE_SIZE + 5; index += 1) {
      await addTestCase(space, `Draft number ${index}`, "DRAFT");
    }

    const page = await listTestCases(
      { projectId: space.project.id, statuses: ["APPROVED"], pageSize: PICKER_PAGE_SIZE },
      deps(space),
    );

    // Filtering in the query rather than over a fetched page: thirty newer
    // drafts no longer push the only runnable test out of sight.
    expect(page.total).toBe(1);
    expect(page.items.map((item) => item.id)).toEqual([approved.id]);
  });

  it("counts everything while showing a sample, so the page can say so", async () => {
    const space = await workspace();
    for (let index = 0; index < PICKER_PAGE_SIZE + 7; index += 1) {
      await addRequirement(space, `Requirement number ${index}`);
    }

    const page = await listRequirements(
      { projectId: space.project.id, pageSize: PICKER_PAGE_SIZE },
      deps(space),
    );

    expect(page.items).toHaveLength(PICKER_PAGE_SIZE);
    expect(page.total).toBe(PICKER_PAGE_SIZE + 7);
  });

  it("reaches a requirement that the first page does not contain", async () => {
    const space = await workspace();
    // Created first, so every later requirement sorts above it.
    const buried = await addRequirement(space, "Refunds are issued within five days");
    for (let index = 0; index < PICKER_PAGE_SIZE + 5; index += 1) {
      await addRequirement(space, `Unrelated requirement ${index}`);
    }

    const firstPage = await listRequirements(
      { projectId: space.project.id, pageSize: PICKER_PAGE_SIZE },
      deps(space),
    );
    expect(firstPage.items.map((item) => item.id)).not.toContain(buried.id);

    // The search runs in the database, so it reaches what the sample omitted.
    const searched = await listRequirements(
      { projectId: space.project.id, search: "Refunds", pageSize: PICKER_PAGE_SIZE },
      deps(space),
    );
    expect(searched.items.map((item) => item.id)).toEqual([buried.id]);
  });

  it("searches test cases by title too", async () => {
    const space = await workspace();
    const wanted = await addTestCase(space, "Saved card pays for an order", "APPROVED");
    for (let index = 0; index < PICKER_PAGE_SIZE + 3; index += 1) {
      await addTestCase(space, `Approved filler ${index}`, "APPROVED");
    }

    const searched = await listTestCases(
      {
        projectId: space.project.id,
        statuses: ["APPROVED"],
        search: "Saved card",
        pageSize: PICKER_PAGE_SIZE,
      },
      deps(space),
    );

    expect(searched.items.map((item) => item.id)).toEqual([wanted.id]);
  });

  it("keeps one project's options out of another's", async () => {
    const space = await workspace();
    const other = await prisma.project.create({
      data: {
        organizationId: space.organization.id,
        name: "Other",
        slug: unique("other"),
        createdByUserId: space.owner.id,
      },
    });
    await addRequirement(space, "Only in checkout");

    const page = await listRequirements(
      { projectId: other.id, search: "Only in checkout", pageSize: PICKER_PAGE_SIZE },
      deps(space),
    );

    expect(page.items).toHaveLength(0);
  });
});
