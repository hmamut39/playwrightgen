import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient, ProjectMembershipRole } from "@/generated/prisma/client";
import { createRequirement, submitRequirementForReview } from "@/lib/services/requirements";
import { getOrganizationReviewCounts, getReviewQueue } from "@/lib/services/review-queue";
import { createTestCase, submitTestCaseForReview } from "@/lib/services/test-cases";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

describe("review queue", () => {
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
      data: { clerkOrganizationId: unique("org"), name: "Queue", slug: unique("queue") },
    });
    await prisma.membership.create({
      data: { organizationId: organization.id, userId: owner.id, role: "OWNER" },
    });
    const project = await prisma.project.create({
      data: { organizationId: organization.id, name: "Checkout", slug: unique("p"), createdByUserId: owner.id },
    });
    return { owner, organization, project };
  }

  async function person(space: Awaited<ReturnType<typeof workspace>>, role: ProjectMembershipRole) {
    const user = await prisma.user.create({ data: { clerkUserId: unique(role), displayName: role } });
    await prisma.membership.create({
      data: { organizationId: space.organization.id, userId: user.id, role: "MEMBER" },
    });
    await prisma.projectMembership.create({
      data: { organizationId: space.organization.id, projectId: space.project.id, userId: user.id, role },
    });
    return user;
  }

  const as = (space: Awaited<ReturnType<typeof workspace>>, user: { clerkUserId: string }) => ({
    authenticate: async () => ({ userId: user.clerkUserId, orgId: space.organization.clerkOrganizationId }),
    prisma,
  });

  it("puts a member's submission in the lead's turn and the lead's own in someone else's", async () => {
    const space = await workspace();
    const member = await person(space, "MEMBER");
    const lead = await person(space, "PROJECT_LEAD");

    const requirement = await createRequirement({
      projectId: space.project.id,
      title: "Refunds are traceable",
      description: "Every refund links to its order.",
      acceptanceCriteria: "The order shows the refund.",
    }, as(space, member));
    await submitRequirementForReview({ projectId: space.project.id, requirementId: requirement.id }, as(space, member));

    const testCase = await createTestCase({
      projectId: space.project.id,
      title: "Lead-written case",
      objective: "Checks a refund.",
      steps: ["Refund an order"],
      expectedResults: ["The refund is linked"],
    }, as(space, lead));
    await submitTestCaseForReview({ projectId: space.project.id, testCaseId: testCase.id }, as(space, lead));

    const leadQueue = await getReviewQueue({ projectId: space.project.id }, as(space, lead));
    expect(leadQueue.yours.map((item) => item.id)).toEqual([requirement.id]);
    expect(leadQueue.yours[0]).toMatchObject({ submittedBy: "MEMBER", waitingDays: 0 });
    expect(leadQueue.others).toEqual([
      expect.objectContaining({ id: testCase.id, reason: "own_submission" }),
    ]);

    const memberQueue = await getReviewQueue({ projectId: space.project.id }, as(space, member));
    expect(memberQueue.yours).toEqual([]);
    expect(memberQueue.others.map((item) => item.reason)).toEqual(["not_an_approver", "not_an_approver"]);

    const ownerQueue = await getReviewQueue({ projectId: space.project.id }, as(space, space.owner));
    expect(ownerQueue.yours.map((item) => item.kind).sort()).toEqual(["requirement", "testCase"]);
  });

  it("counts what waits in each project for the workspace home", async () => {
    const space = await workspace();
    const other = await workspace();
    for (const title of ["First", "Second"]) {
      const requirement = await createRequirement({
        projectId: space.project.id,
        title,
        description: "Described.",
        acceptanceCriteria: "Measurable.",
      }, as(space, space.owner));
      await submitRequirementForReview({ projectId: space.project.id, requirementId: requirement.id }, as(space, space.owner));
    }
    await createRequirement({ projectId: space.project.id, title: "Still a draft" }, as(space, space.owner));
    const foreign = await createRequirement({
      projectId: other.project.id,
      title: "Elsewhere",
      description: "Described.",
      acceptanceCriteria: "Measurable.",
    }, as(other, other.owner));
    await submitRequirementForReview({ projectId: other.project.id, requirementId: foreign.id }, as(other, other.owner));

    const counts = await getOrganizationReviewCounts({}, as(space, space.owner));
    expect([...counts.entries()]).toEqual([[space.project.id, 2]]);
  });

  it("counts how long something has waited", async () => {
    const space = await workspace();
    const requirement = await createRequirement({
      projectId: space.project.id,
      title: "Old request",
      description: "Waiting.",
      acceptanceCriteria: "Approved eventually.",
    }, as(space, space.owner));
    await submitRequirementForReview({ projectId: space.project.id, requirementId: requirement.id }, as(space, space.owner));

    const later = new Date(Date.now() + 4 * 86_400_000);
    const queue = await getReviewQueue({ projectId: space.project.id, now: later }, as(space, space.owner));
    // A sole owner is never blocked by their own submission.
    expect(queue.yours[0]).toMatchObject({ id: requirement.id, waitingDays: 4 });
  });
});
