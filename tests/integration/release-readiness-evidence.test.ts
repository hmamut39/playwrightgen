import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { getReleaseReadiness } from "@/lib/services/release-readiness";
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
 * Release readiness must never call an absence of execution a pass.
 *
 * The page states "missing evidence is reported as missing and never counted
 * as a pass", and a green "nothing is blocking this release" is the single
 * most consequential claim the product makes. A project that has approved
 * documents but has never run anything has produced no execution evidence at
 * all, and has to be reported as blocked.
 */
describe("release readiness and missing execution evidence", () => {
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
        name: "Release workspace",
        slug: unique("release"),
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

  it("blocks a release when nothing has ever been executed", async () => {
    const space = await workspace();
    const d = deps(space);

    // Approved intent, fully linked, and not one test run. Every document was
    // touched moments ago, which is exactly the case where a freshness clock
    // driven by document edits looks healthy while no code has ever run.
    const requirement = await createRequirement({
      projectId: space.project.id,
      title: "Customers can pay by card",
      description: "Card payment succeeds for a valid card.",
      acceptanceCriteria: "A valid card produces an order confirmation.",
    }, d);
    await submitRequirementForReview({ projectId: space.project.id, requirementId: requirement.id }, d);
    await approveRequirement({ projectId: space.project.id, requirementId: requirement.id }, d);

    const testCase = await createTestCase({
      projectId: space.project.id,
      title: "Card payment succeeds",
      objective: "Verify a valid card produces a confirmation.",
      steps: ["Submit a valid card"],
      expectedResults: ["A confirmation appears"],
    }, d);
    await submitTestCaseForReview({ projectId: space.project.id, testCaseId: testCase.id }, d);
    await approveTestCase({ projectId: space.project.id, testCaseId: testCase.id }, d);
    await linkRequirementToTestCase({
      projectId: space.project.id,
      testCaseId: testCase.id,
      requirementId: requirement.id,
    }, d);

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, d);

    const attempts = await prisma.testRunAttempt.count({
      where: { organizationId: space.organization.id, projectId: space.project.id },
    });
    expect(attempts).toBe(0);

    expect(readiness.releasable).toBe(false);
    expect(readiness.findings.some((f) => f.code === "evidence_missing")).toBe(true);
  });

  it("clears the blocker once something has actually run", async () => {
    // The counterpart to the case above. A gate that blocked unconditionally
    // would satisfy the previous test while making the page useless, so the
    // passing direction has to be pinned too.
    const space = await workspace();
    const d = deps(space);

    const requirement = await createRequirement({
      projectId: space.project.id,
      title: "Customers can pay by card",
      description: "Card payment succeeds for a valid card.",
      acceptanceCriteria: "A valid card produces an order confirmation.",
    }, d);
    await submitRequirementForReview({ projectId: space.project.id, requirementId: requirement.id }, d);
    await approveRequirement({ projectId: space.project.id, requirementId: requirement.id }, d);

    const testCase = await createTestCase({
      projectId: space.project.id,
      title: "Card payment succeeds",
      objective: "Verify a valid card produces a confirmation.",
      steps: ["Submit a valid card"],
      expectedResults: ["A confirmation appears"],
    }, d);
    await submitTestCaseForReview({ projectId: space.project.id, testCaseId: testCase.id }, d);
    await approveTestCase({ projectId: space.project.id, testCaseId: testCase.id }, d);
    await linkRequirementToTestCase({
      projectId: space.project.id,
      testCaseId: testCase.id,
      requirementId: requirement.id,
    }, d);

    const version = await prisma.testCaseVersion.findFirstOrThrow({
      where: { testCaseId: testCase.id },
      orderBy: { versionNumber: "desc" },
    });
    const testRun = await prisma.testRun.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        testCaseId: testCase.id,
        testCaseVersionId: version.id,
        name: "Card payment smoke",
        status: "PASSED",
        latestAttemptNumber: 1,
        createdByUserId: space.owner.id,
      },
    });
    await prisma.testRunAttempt.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        testRunId: testRun.id,
        attemptNumber: 1,
        result: "PASSED",
        mode: "MANUAL",
        environment: "STAGING",
        browser: "NONE",
        summary: "Card payment produced a confirmation.",
        failureDetails: "",
        stepResults: [],
        evidence: [],
        executedByUserId: space.owner.id,
      },
    });

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, d);

    expect(readiness.findings.some((f) => f.code === "evidence_missing")).toBe(false);
    expect(readiness.releasable).toBe(true);
  });

  it("blocks an entirely empty project", async () => {
    const space = await workspace();

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, deps(space));

    expect(readiness.releasable).toBe(false);
  });
});
