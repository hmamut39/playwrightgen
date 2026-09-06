import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { getProjectSetup } from "@/lib/services/project-setup";
import {
  approveRequirement,
  createRequirement,
  submitRequirementForReview,
} from "@/lib/services/requirements";
import {
  approveTestCase,
  createTestCase,
  linkRequirementToTestCase,
  submitTestCaseForReview,
} from "@/lib/services/test-cases";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

describe("project setup chain", () => {
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
        name: "Setup workspace",
        slug: unique("setup"),
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

  const stepFor = (
    setup: Awaited<ReturnType<typeof getProjectSetup>>,
    key: string,
  ) => setup.steps.find((step) => step.key === key);

  it("reports every step incomplete for a new project", async () => {
    const space = await workspace();

    const setup = await getProjectSetup({ projectId: space.project.id }, deps(space));

    expect(setup.completedCount).toBe(0);
    expect(setup.complete).toBe(false);
    expect(setup.steps.every((step) => !step.done)).toBe(true);
    // Every step must offer somewhere to go, or the checklist tells someone
    // what is missing without telling them where to fix it.
    expect(setup.steps.every((step) => step.href.includes(space.project.id))).toBe(true);
  });

  it("counts a requirement only once it is approved, not when drafted", async () => {
    const space = await workspace();
    const requirement = await createRequirement({
      projectId: space.project.id,
      title: "Customers can pay by card",
      description: "Card payment succeeds for a valid card.",
      acceptanceCriteria: "A valid card produces an order confirmation.",
    }, deps(space));

    const drafted = await getProjectSetup({ projectId: space.project.id }, deps(space));
    expect(stepFor(drafted, "requirement")?.done).toBe(false);

    await submitRequirementForReview({
      projectId: space.project.id,
      requirementId: requirement.id,
    }, deps(space));
    await approveRequirement({
      projectId: space.project.id,
      requirementId: requirement.id,
    }, deps(space));

    const approved = await getProjectSetup({ projectId: space.project.id }, deps(space));
    expect(stepFor(approved, "requirement")?.done).toBe(true);
    expect(stepFor(approved, "requirement")?.count).toBe(1);
  });

  it("treats the traceability link as its own step", async () => {
    const space = await workspace();
    const requirement = await createRequirement({
      projectId: space.project.id,
      title: "Customers can pay by card",
      description: "Card payment succeeds.",
      acceptanceCriteria: "A confirmation appears.",
    }, deps(space));
    await submitRequirementForReview({ projectId: space.project.id, requirementId: requirement.id }, deps(space));
    await approveRequirement({ projectId: space.project.id, requirementId: requirement.id }, deps(space));

    const testCase = await createTestCase({
      projectId: space.project.id,
      title: "Card payment succeeds",
      objective: "Verify a valid card produces a confirmation.",
      steps: ["Submit a valid card"],
      expectedResults: ["A confirmation appears"],
    }, deps(space));
    await submitTestCaseForReview({ projectId: space.project.id, testCaseId: testCase.id }, deps(space));
    await approveTestCase({ projectId: space.project.id, testCaseId: testCase.id }, deps(space));

    // Both approved, still not linked: the requirement reads as unverified, and
    // the checklist has to say so rather than implying coverage exists.
    const unlinked = await getProjectSetup({ projectId: space.project.id }, deps(space));
    expect(stepFor(unlinked, "requirement")?.done).toBe(true);
    expect(stepFor(unlinked, "test-case")?.done).toBe(true);
    expect(stepFor(unlinked, "link")?.done).toBe(false);

    await linkRequirementToTestCase({
      projectId: space.project.id,
      testCaseId: testCase.id,
      requirementId: requirement.id,
    }, deps(space));

    const linked = await getProjectSetup({ projectId: space.project.id }, deps(space));
    expect(stepFor(linked, "link")?.done).toBe(true);
    expect(linked.completedCount).toBe(3);
    expect(linked.complete).toBe(false);
  });

  it("does not count another project's progress", async () => {
    const space = await workspace();
    const other = await prisma.project.create({
      data: {
        organizationId: space.organization.id,
        name: "Billing",
        slug: unique("billing"),
        createdByUserId: space.owner.id,
      },
    });
    const requirement = await createRequirement({
      projectId: space.project.id,
      title: "Scoped to one project",
      description: "d",
      acceptanceCriteria: "a",
    }, deps(space));
    await submitRequirementForReview({ projectId: space.project.id, requirementId: requirement.id }, deps(space));
    await approveRequirement({ projectId: space.project.id, requirementId: requirement.id }, deps(space));

    const setup = await getProjectSetup({ projectId: other.id }, deps(space));

    expect(stepFor(setup, "requirement")?.done).toBe(false);
    expect(setup.completedCount).toBe(0);
  });
});
