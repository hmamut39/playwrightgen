import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { checkSelfApproval } from "@/lib/services/approval-policy";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

/**
 * The separation-of-duties rule turns on one question: is there anybody else
 * who could approve this? Getting that count wrong in either direction is a
 * real failure -- too high and a solo founder is locked out of their own
 * workspace by a colleague who left months ago; too low and a lead signs off
 * their own work while a reviewer sits idle. These tests pin who counts.
 */
describe("self-approval rule", () => {
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

  async function setup() {
    const author = await prisma.user.create({
      data: { clerkUserId: unique("author"), displayName: "Author" },
    });
    const organization = await prisma.organization.create({
      data: { clerkOrganizationId: unique("org"), name: "Policy", slug: unique("policy") },
    });
    await prisma.membership.create({
      data: { organizationId: organization.id, userId: author.id, role: "OWNER" },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: organization.id,
        name: "Checkout",
        slug: unique("checkout"),
        createdByUserId: author.id,
      },
    });
    const targetId = randomUUID();
    await prisma.activity.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        actorUserId: author.id,
        source: "USER",
        action: "TEST_CASE_SUBMITTED_FOR_REVIEW",
        targetType: "TEST_CASE",
        targetId,
      },
    });
    const check = (approverUserId: string) =>
      checkSelfApproval(prisma, {
        organizationId: organization.id,
        projectId: project.id,
        targetType: "TEST_CASE",
        targetId,
        submittedAction: "TEST_CASE_SUBMITTED_FOR_REVIEW",
        approverUserId,
      });
    return { author, organization, project, check };
  }

  async function addColleague(
    organizationId: string,
    options: {
      role: "OWNER" | "ADMIN" | "MEMBER";
      userStatus?: "ACTIVE" | "DISABLED";
      membershipStatus?: "ACTIVE" | "REMOVED";
      projectLeadOf?: { projectId: string; status?: "ACTIVE" | "REMOVED" };
    },
  ) {
    const user = await prisma.user.create({
      data: {
        clerkUserId: unique("colleague"),
        displayName: "Colleague",
        status: options.userStatus ?? "ACTIVE",
      },
    });
    await prisma.membership.create({
      data: {
        organizationId,
        userId: user.id,
        role: options.role,
        status: options.membershipStatus ?? "ACTIVE",
      },
    });
    if (options.projectLeadOf) {
      await prisma.projectMembership.create({
        data: {
          organizationId,
          projectId: options.projectLeadOf.projectId,
          userId: user.id,
          role: "PROJECT_LEAD",
          status: options.projectLeadOf.status ?? "ACTIVE",
        },
      });
    }
    return user;
  }

  it("lets the only possible approver approve their own submission", async () => {
    const { author, check } = await setup();
    await expect(check(author.id)).resolves.toEqual({ allowed: true, reason: "sole_approver" });
  });

  it("always lets a different person approve", async () => {
    const { organization, check } = await setup();
    const reviewer = await addColleague(organization.id, { role: "ADMIN" });
    await expect(check(reviewer.id)).resolves.toEqual({ allowed: true, reason: "different_person" });
  });

  it("refuses self-approval once an admin could approve instead", async () => {
    const { author, organization, check } = await setup();
    await addColleague(organization.id, { role: "ADMIN" });
    await expect(check(author.id)).resolves.toEqual({
      allowed: false,
      reason: "another_approver_exists",
    });
  });

  it("refuses self-approval once a lead of this project could approve instead", async () => {
    const { author, organization, project, check } = await setup();
    await addColleague(organization.id, {
      role: "MEMBER",
      projectLeadOf: { projectId: project.id },
    });
    await expect(check(author.id)).resolves.toMatchObject({ allowed: false });
  });

  it("does not count people who cannot actually approve", async () => {
    const { author, organization, project, check } = await setup();
    const otherProject = await prisma.project.create({
      data: {
        organizationId: organization.id,
        name: "Elsewhere",
        slug: unique("elsewhere"),
        createdByUserId: author.id,
      },
    });
    // A plain member, a disabled admin, a removed owner, a lead of a different
    // project, and a lead whose project role was taken away.
    await addColleague(organization.id, { role: "MEMBER" });
    await addColleague(organization.id, { role: "ADMIN", userStatus: "DISABLED" });
    await addColleague(organization.id, { role: "OWNER", membershipStatus: "REMOVED" });
    await addColleague(organization.id, {
      role: "MEMBER",
      projectLeadOf: { projectId: otherProject.id },
    });
    await addColleague(organization.id, {
      role: "MEMBER",
      projectLeadOf: { projectId: project.id, status: "REMOVED" },
    });

    await expect(check(author.id)).resolves.toEqual({ allowed: true, reason: "sole_approver" });
  });
});
