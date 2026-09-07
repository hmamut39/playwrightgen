import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { getReleaseEvidenceReport } from "@/lib/services/release-evidence";
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

/**
 * The report is what somebody signs, so its verdicts have to be conservative in
 * exactly one direction: never call something verified that has not run and
 * passed.
 */
describe("release evidence report", () => {
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
        name: "Evidence workspace",
        slug: unique("evidence"),
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

  async function approvedRequirement(
    space: Awaited<ReturnType<typeof workspace>>,
    title = "Customers can pay by card",
  ) {
    const requirement = await createRequirement({
      projectId: space.project.id,
      title,
      description: "A signed-in customer can pay with a valid card.",
      acceptanceCriteria: "A valid card produces an order confirmation.",
    }, deps(space));
    await submitRequirementForReview({
      projectId: space.project.id, requirementId: requirement.id,
    }, deps(space));
    await approveRequirement({
      projectId: space.project.id, requirementId: requirement.id,
    }, deps(space));
    return requirement;
  }

  async function linkedTestCase(
    space: Awaited<ReturnType<typeof workspace>>,
    requirementId: string,
    approve: boolean,
  ) {
    const testCase = await createTestCase({
      projectId: space.project.id,
      title: unique("Card payment"),
      objective: "Verify a valid card produces a confirmation.",
      steps: ["Submit a valid card"],
      expectedResults: ["A confirmation appears"],
    }, deps(space));
    await linkRequirementToTestCase({
      projectId: space.project.id, testCaseId: testCase.id, requirementId,
    }, deps(space));
    if (approve) {
      await submitTestCaseForReview({
        projectId: space.project.id, testCaseId: testCase.id,
      }, deps(space));
      await approveTestCase({
        projectId: space.project.id, testCaseId: testCase.id,
      }, deps(space));
    }
    return testCase;
  }

  async function recordAttempt(
    space: Awaited<ReturnType<typeof workspace>>,
    testCaseId: string,
    result: "PASSED" | "FAILED",
  ) {
    const version = await prisma.testCaseVersion.findFirstOrThrow({
      where: { testCaseId }, orderBy: { versionNumber: "desc" },
    });
    const run = await prisma.testRun.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        testCaseId,
        testCaseVersionId: version.id,
        name: "Smoke",
        status: result,
        latestAttemptNumber: 1,
        createdByUserId: space.owner.id,
      },
    });
    await prisma.testRunAttempt.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        testRunId: run.id,
        attemptNumber: 1,
        result,
        mode: "MANUAL",
        environment: "STAGING",
        browser: "NONE",
        summary: "Recorded by a test.",
        failureDetails: result === "FAILED" ? "It did not pass." : "",
        stepResults: [],
        evidence: [],
        commitSha: "a".repeat(40),
        executedByUserId: space.owner.id,
      },
    });
  }

  it("calls a requirement verified only once an approved test ran and passed", async () => {
    const space = await workspace();
    const requirement = await approvedRequirement(space);
    const testCase = await linkedTestCase(space, requirement.id, true);
    await recordAttempt(space, testCase.id, "PASSED");

    const report = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));

    expect(report.requirements).toHaveLength(1);
    expect(report.requirements[0].verdict).toBe("VERIFIED");
    expect(report.totals).toMatchObject({ verified: 1, failing: 0, unverified: 0 });
    expect(report.requirements[0].testCases[0].latestResult).toBe("PASSED");
  });

  it("reports a failing test as failing rather than as coverage", async () => {
    const space = await workspace();
    const requirement = await approvedRequirement(space);
    const testCase = await linkedTestCase(space, requirement.id, true);
    await recordAttempt(space, testCase.id, "FAILED");

    const report = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));

    expect(report.requirements[0].verdict).toBe("FAILING");
    expect(report.totals.failing).toBe(1);
  });

  it("does not count a draft test case as coverage", async () => {
    // The distinction the whole report rests on: intended coverage is not
    // coverage. A proposal that was never approved verifies nothing.
    const space = await workspace();
    const requirement = await approvedRequirement(space);
    await linkedTestCase(space, requirement.id, false);

    const report = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));

    expect(report.requirements[0].verdict).toBe("UNVERIFIED");
    expect(report.requirements[0].reason).toContain("still a draft");
  });

  it("does not call an approved but never executed test verified", async () => {
    const space = await workspace();
    const requirement = await approvedRequirement(space);
    await linkedTestCase(space, requirement.id, true);

    const report = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));

    expect(report.requirements[0].verdict).toBe("UNVERIFIED");
    expect(report.requirements[0].reason).toContain("never run");
  });

  it("says plainly when nothing is linked at all", async () => {
    const space = await workspace();
    await approvedRequirement(space);

    const report = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));

    expect(report.requirements[0].verdict).toBe("UNVERIFIED");
    expect(report.requirements[0].testCases).toHaveLength(0);
    expect(report.requirements[0].reason).toContain("Nothing is linked");
  });

  it("reports each requirement separately", async () => {
    const space = await workspace();
    const covered = await approvedRequirement(space, "Customers can pay by card");
    await approvedRequirement(space, "Customers can request a refund");
    const testCase = await linkedTestCase(space, covered.id, true);
    await recordAttempt(space, testCase.id, "PASSED");

    const report = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));

    expect(report.requirements).toHaveLength(2);
    expect(report.totals).toMatchObject({ verified: 1, unverified: 1 });
  });
});
