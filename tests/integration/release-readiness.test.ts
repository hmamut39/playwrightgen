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
  submitTestCaseForReview,
} from "@/lib/services/test-cases";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

describe("release readiness", () => {
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

  const codes = (readiness: Awaited<ReturnType<typeof getReleaseReadiness>>) =>
    readiness.findings.map((finding) => finding.code);

  it("blocks a project that has produced no execution evidence", async () => {
    const space = await workspace();

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, deps(space));

    // An empty project must not read as ready. Absence of evidence is not a pass.
    expect(readiness.releasable).toBe(false);
    expect(codes(readiness)).toContain("evidence_missing");
  });

  it("blocks an approved requirement that nothing verifies", async () => {
    const space = await workspace();
    const requirement = await createRequirement({
      projectId: space.project.id,
      title: "Customers can pay by card",
      description: "Card payment must succeed for a valid card.",
      acceptanceCriteria: "A valid card produces an order confirmation.",
    }, deps(space));
    await submitRequirementForReview({
      projectId: space.project.id,
      requirementId: requirement.id,
    }, deps(space));
    await approveRequirement({
      projectId: space.project.id,
      requirementId: requirement.id,
    }, deps(space));

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, deps(space));

    expect(readiness.releasable).toBe(false);
    expect(codes(readiness)).toContain("requirements_uncovered");
    expect(readiness.counts.approvedRequirements).toBe(1);
    expect(readiness.counts.requirementsWithApprovedTests).toBe(0);
  });

  it("separates blocking conditions from cautions", async () => {
    const space = await workspace();

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, deps(space));

    const blockers = readiness.findings.filter((f) => f.severity === "BLOCKER");
    const cautions = readiness.findings.filter((f) => f.severity === "CAUTION");

    // Blockers sort ahead of cautions so a reader sees what stops the release first.
    expect(blockers.length).toBeGreaterThan(0);
    expect(readiness.findings.slice(0, blockers.length).every((f) => f.severity === "BLOCKER")).toBe(true);
    expect(cautions.every((f) => f.severity === "CAUTION")).toBe(true);
    expect(readiness.releasable).toBe(blockers.length === 0);
  });

  it("links every finding to a record a reviewer can open", async () => {
    const space = await workspace();

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, deps(space));

    for (const finding of readiness.findings) {
      expect(finding.href).toBeTruthy();
      expect(finding.href).toContain(`/projects/${space.project.id}/`);
      expect(finding.detail.length).toBeGreaterThan(20);
    }
  });

  it("produces no numeric readiness score", async () => {
    const space = await workspace();

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, deps(space));

    // A score would compress away the detail a reviewer needs and invite
    // shipping against a number nobody can audit.
    expect(readiness).not.toHaveProperty("score");
    expect(readiness).not.toHaveProperty("percentage");
    expect(readiness).not.toHaveProperty("grade");
  });

  it("does not expose another tenant's project", async () => {
    const space = await workspace();
    const foreign = await workspace();

    await expect(
      getReleaseReadiness({ projectId: foreign.project.id }, deps(space)),
    ).rejects.toBeTruthy();
  });
  /**
   * A project that passes tests and has recorded no requirements.
   *
   * Every blocking condition is a comparison against recorded intent, so with
   * no requirements none of them can fire and the page says "Nothing is
   * blocking this release" by having nothing to check. That is a true
   * sentence a manager reads as a different one -- and since sharing stopped
   * requiring a requirement, this is a state a team can send outside.
   */
  async function provenTestWithNoRequirement(space: Awaited<ReturnType<typeof workspace>>) {
    const testCase = await createTestCase({
      projectId: space.project.id,
      title: "The checkout page loads",
      objective: "Verify the page loads.",
      steps: ["Open the page"],
      expectedResults: ["The form appears"],
    }, deps(space));
    await submitTestCaseForReview({ projectId: space.project.id, testCaseId: testCase.id }, deps(space));
    await approveTestCase({ projectId: space.project.id, testCaseId: testCase.id }, deps(space));

    const version = await prisma.testCaseVersion.findFirstOrThrow({
      where: { testCaseId: testCase.id },
      orderBy: { versionNumber: "desc" },
    });
    const run = await prisma.testRun.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        testCaseId: testCase.id,
        testCaseVersionId: version.id,
        name: "Smoke",
        status: "PASSED",
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
        result: "PASSED",
        mode: "MANUAL",
        environment: "STAGING",
        browser: "NONE",
        summary: "Recorded by a test.",
        failureDetails: "",
        stepResults: [],
        evidence: [],
        commitSha: "a".repeat(40),
        executedByUserId: space.owner.id,
      },
    });
    return testCase;
  }

  it("says what a clear release rests on when no requirement was ever recorded", async () => {
    const space = await workspace();
    await provenTestWithNoRequirement(space);

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, deps(space));

    // The verdict stands -- nothing recorded is blocking -- and what it rests
    // on is said beside it rather than left for the reader to assume.
    expect(readiness.releasable).toBe(true);
    expect(codes(readiness)).toContain("requirements_none");

    const finding = readiness.findings.find((item) => item.code === "requirements_none");
    expect(finding?.severity).toBe("CAUTION");
    expect(finding?.detail).toContain("not about whether the product does what was agreed");
  });

  it("does not refuse the release merely because no requirement exists", async () => {
    const space = await workspace();
    await provenTestWithNoRequirement(space);

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, deps(space));

    // Blocking here would be the product inventing a process, and would
    // contradict the evidence it now accepts from approved tests alone.
    expect(readiness.findings.filter((item) => item.severity === "BLOCKER")).toHaveLength(0);
  });

  it("says nothing about missing requirements once one is approved", async () => {
    const space = await workspace();
    const requirement = await createRequirement({
      projectId: space.project.id,
      title: "Customers can pay by card",
      description: "Card payment must succeed for a valid card.",
      acceptanceCriteria: "A valid card produces an order confirmation.",
    }, deps(space));
    await submitRequirementForReview({ projectId: space.project.id, requirementId: requirement.id }, deps(space));
    await approveRequirement({ projectId: space.project.id, requirementId: requirement.id }, deps(space));

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, deps(space));

    expect(codes(readiness)).not.toContain("requirements_none");
  });
});
