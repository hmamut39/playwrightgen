import { randomUUID } from "node:crypto";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import type {
  MembershipRole,
  PrismaClient,
  ProjectMembershipRole,
} from "@/generated/prisma/client";
import { getProjectQualityIntelligence } from "@/lib/services/project-quality";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

function uniqueValue(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describe("project quality intelligence", () => {
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

  async function createWorkspace(options: {
    role?: MembershipRole;
    projectRole?: ProjectMembershipRole;
  } = {}) {
    const user = await prisma.user.create({
      data: { clerkUserId: uniqueValue("clerk-user"), displayName: "Quality lead" },
    });
    const organization = await prisma.organization.create({
      data: {
        clerkOrganizationId: uniqueValue("clerk-org"),
        name: "Quality workspace",
        slug: uniqueValue("quality-workspace"),
      },
    });
    await prisma.membership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: options.role ?? "OWNER",
      },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: organization.id,
        name: "Checkout quality",
        slug: uniqueValue("checkout-quality"),
        createdByUserId: user.id,
      },
    });
    if (options.projectRole) {
      await prisma.projectMembership.create({
        data: {
          organizationId: organization.id,
          projectId: project.id,
          userId: user.id,
          role: options.projectRole,
        },
      });
    }
    return { user, organization, project };
  }

  function dependencies(workspace: Awaited<ReturnType<typeof createWorkspace>>) {
    return {
      authenticate: async () => ({
        userId: workspace.user.clerkUserId,
        orgId: workspace.organization.clerkOrganizationId,
      }),
      prisma,
    };
  }

  async function createApprovedRequirement(
    workspace: Awaited<ReturnType<typeof createWorkspace>>,
    title: string,
  ) {
    return prisma.requirement.create({
      data: {
        organizationId: workspace.organization.id,
        projectId: workspace.project.id,
        title,
        description: `${title} description`,
        acceptanceCriteria: `${title} acceptance criteria`,
        status: "APPROVED",
        approvedAt: new Date("2026-08-22T12:00:00.000Z"),
        ownerUserId: workspace.user.id,
        createdByUserId: workspace.user.id,
      },
    });
  }

  async function createApprovedTestCase(
    workspace: Awaited<ReturnType<typeof createWorkspace>>,
    title: string,
    currentVersionNumber = 1,
  ) {
    const testCase = await prisma.testCase.create({
      data: {
        organizationId: workspace.organization.id,
        projectId: workspace.project.id,
        title,
        objective: `${title} objective`,
        preconditions: "Signed in user",
        steps: [{ action: "Complete the flow" }],
        expectedResults: [{ result: "The outcome is visible" }],
        status: "APPROVED",
        approvedAt: new Date("2026-08-22T13:00:00.000Z"),
        automationStatus: "AUTOMATED",
        currentVersionNumber,
        ownerUserId: workspace.user.id,
        createdByUserId: workspace.user.id,
      },
    });
    const versions = [];
    for (let versionNumber = 1; versionNumber <= currentVersionNumber; versionNumber += 1) {
      versions.push(
        await prisma.testCaseVersion.create({
          data: {
            organizationId: workspace.organization.id,
            projectId: workspace.project.id,
            testCaseId: testCase.id,
            versionNumber,
            title,
            objective: `${title} objective v${versionNumber}`,
            preconditions: "Signed in user",
            steps: [{ action: "Complete the flow" }],
            expectedResults: [{ result: "The outcome is visible" }],
            priority: "HIGH",
            type: "END_TO_END",
            source: "MANUAL",
            tags: [],
            automationStatus: "AUTOMATED",
            ownerUserId: workspace.user.id,
            createdByUserId: workspace.user.id,
          },
        }),
      );
    }
    return { testCase, versions };
  }

  it("derives actionable gaps only from project records", async () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    const workspace = await createWorkspace();
    const coveredRequirement = await createApprovedRequirement(
      workspace,
      "Card payment succeeds",
    );
    const uncoveredRequirement = await createApprovedRequirement(
      workspace,
      "Card payment is declined",
    );
    const automated = await createApprovedTestCase(
      workspace,
      "Successful card payment",
    );
    const manual = await createApprovedTestCase(
      workspace,
      "Declined card payment",
    );
    const stale = await createApprovedTestCase(
      workspace,
      "Updated refund flow",
      2,
    );

    await prisma.requirementTestCase.create({
      data: {
        organizationId: workspace.organization.id,
        projectId: workspace.project.id,
        requirementId: coveredRequirement.id,
        testCaseId: automated.testCase.id,
        createdByUserId: workspace.user.id,
      },
    });
    await prisma.automationArtifact.create({
      data: {
        organizationId: workspace.organization.id,
        projectId: workspace.project.id,
        testCaseId: automated.testCase.id,
        testCaseVersionId: automated.versions[0].id,
        engine: "PLAYWRIGHT_BROWSER",
        name: "Successful card payment browser test",
        status: "APPROVED",
        currentVersionNumber: 1,
        approvedVersionNumber: 1,
        approvedAt: new Date("2026-08-22T14:00:00.000Z"),
        createdByUserId: workspace.user.id,
        approvedByUserId: workspace.user.id,
      },
    });
    const staleArtifact = await prisma.automationArtifact.create({
      data: {
        organizationId: workspace.organization.id,
        projectId: workspace.project.id,
        testCaseId: stale.testCase.id,
        testCaseVersionId: stale.versions[0].id,
        engine: "PLAYWRIGHT_BROWSER",
        name: "Refund browser test",
        status: "APPROVED",
        currentVersionNumber: 1,
        approvedVersionNumber: 1,
        approvedAt: new Date("2026-08-20T14:00:00.000Z"),
        createdByUserId: workspace.user.id,
        approvedByUserId: workspace.user.id,
      },
    });
    const testRun = await prisma.testRun.create({
      data: {
        organizationId: workspace.organization.id,
        projectId: workspace.project.id,
        testCaseId: manual.testCase.id,
        testCaseVersionId: manual.versions[0].id,
        name: "Declined payment regression",
        status: "FAILED",
        latestAttemptNumber: 1,
        createdByUserId: workspace.user.id,
      },
    });
    const failedAttempt = await prisma.testRunAttempt.create({
      data: {
        organizationId: workspace.organization.id,
        projectId: workspace.project.id,
        testRunId: testRun.id,
        attemptNumber: 1,
        result: "FAILED",
        mode: "MANUAL",
        environment: "STAGING",
        browser: "NONE",
        summary: "Payment declined unexpectedly",
        failureDetails: "The response did not match the expected state.",
        stepResults: [],
        evidence: [],
        executedByUserId: workspace.user.id,
        executedAt: new Date("2026-08-23T10:00:00.000Z"),
      },
    });

    const intelligence = await getProjectQualityIntelligence(
      { projectId: workspace.project.id, now },
      dependencies(workspace),
    );

    expect(intelligence.counts).toMatchObject({
      approvedRequirements: 2,
      requirementsWithApprovedTests: 1,
      approvedTestCases: 3,
      testCasesWithCurrentAutomation: 1,
      recentAttempts: 1,
      recentFailedAttempts: 1,
    });
    expect(intelligence.gaps.requirementsWithoutApprovedTests.map((item) => item.id))
      .toEqual([uncoveredRequirement.id]);
    expect(intelligence.gaps.testCasesWithoutCurrentAutomation.map((item) => item.id))
      .toEqual(expect.arrayContaining([manual.testCase.id, stale.testCase.id]));
    expect(intelligence.gaps.staleAutomation).toEqual([
      expect.objectContaining({
        id: staleArtifact.id,
        automatedVersionNumber: 1,
        currentVersionNumber: 2,
      }),
    ]);
    expect(intelligence.gaps.unreviewedFailedAttempts).toEqual([
      expect.objectContaining({ id: failedAttempt.id, testRunId: testRun.id }),
    ]);
    expect(intelligence.evidence).toMatchObject({
      freshness: "FRESH",
      ageDays: 0,
    });
  });

  it("counts every recent failure, not the page of them it lists", async () => {
    // The tile reads "{failed} of {total} recent attempts failed", with the
    // total from a real count and the failures counted from a list capped at
    // twenty-five. A project with more failures than that was told it had
    // twenty-five, on the page called Quality, in the one direction nobody
    // would question.
    const workspace = await createWorkspace();
    const testCase = await createApprovedTestCase(workspace, "Checkout fails under load");
    const run = await prisma.testRun.create({
      data: {
        organizationId: workspace.organization.id,
        projectId: workspace.project.id,
        testCaseId: testCase.testCase.id,
        testCaseVersionId: testCase.versions[0].id,
        name: "Nightly",
        status: "FAILED",
        latestAttemptNumber: 30,
        createdByUserId: workspace.user.id,
      },
    });
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      await prisma.testRunAttempt.create({
        data: {
          organizationId: workspace.organization.id,
          projectId: workspace.project.id,
          testRunId: run.id,
          attemptNumber: attempt,
          result: "FAILED",
          mode: "MANUAL",
          environment: "STAGING",
          browser: "NONE",
          summary: `Attempt ${attempt}`,
          failureDetails: "It did not pass.",
          stepResults: [],
          evidence: [],
          executedByUserId: workspace.user.id,
          executedAt: new Date(`2026-08-${String((attempt % 28) + 1).padStart(2, "0")}T10:00:00.000Z`),
        },
      });
    }

    const intelligence = await getProjectQualityIntelligence(
      { projectId: workspace.project.id, now: new Date("2026-08-30T10:00:00.000Z") },
      dependencies(workspace),
    );

    expect(intelligence.counts.recentFailedAttempts).toBe(30);
    expect(intelligence.counts.recentAttempts).toBe(30);
    // The list beside it stays a page of examples, and the page says so.
    expect(intelligence.gaps.unreviewedFailedAttempts).toHaveLength(25);
  });

  it("does not include records belonging to another tenant", async () => {
    const workspace = await createWorkspace();
    const foreign = await createWorkspace();
    await createApprovedRequirement(foreign, "Foreign uncovered requirement");

    const intelligence = await getProjectQualityIntelligence(
      { projectId: workspace.project.id },
      dependencies(workspace),
    );

    expect(intelligence.counts.approvedRequirements).toBe(0);
    expect(intelligence.gaps.requirementsWithoutApprovedTests).toEqual([]);
  });

  it("allows an assigned viewer to read but rejects a foreign project", async () => {
    const viewer = await createWorkspace({
      role: "MEMBER",
      projectRole: "VIEWER",
    });
    const foreign = await createWorkspace();

    await expect(
      getProjectQualityIntelligence(
        { projectId: viewer.project.id },
        dependencies(viewer),
      ),
    ).resolves.toMatchObject({ project: { id: viewer.project.id } });
    await expect(
      getProjectQualityIntelligence(
        { projectId: foreign.project.id },
        dependencies(viewer),
      ),
    ).rejects.toMatchObject({ code: "workspace_not_found", status: 404 });
  });
});
