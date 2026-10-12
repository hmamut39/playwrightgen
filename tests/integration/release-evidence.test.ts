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
    result: "PASSED" | "FAILED" | "BLOCKED",
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

  it("says how old the evidence is, and counts a verdict nobody has rechecked", async () => {
    const space = await workspace();
    const requirement = await approvedRequirement(space);
    const testCase = await linkedTestCase(space, requirement.id, true);
    await recordAttempt(space, testCase.id, "PASSED");
    // The run happened; forty days pass and nobody runs it again.
    await prisma.testRunAttempt.updateMany({
      where: { projectId: space.project.id },
      data: { executedAt: new Date(Date.now() - 40 * 86_400_000) },
    });

    const report = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));

    // Still verified -- the run did pass -- but no longer presented as current.
    expect(report.requirements[0].verdict).toBe("VERIFIED");
    expect(report.requirements[0].freshness).toBe("STALE");
    expect(report.requirements[0].ageDays).toBe(40);
    expect(report.requirements[0].lastVerifiedAt).toBeInstanceOf(Date);
    expect(report.totals).toMatchObject({ verified: 1, stale: 1 });
  });

  it("reports a requirement nothing has run as having no age at all", async () => {
    const space = await workspace();
    const requirement = await approvedRequirement(space);
    await linkedTestCase(space, requirement.id, true);

    const report = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));

    expect(report.requirements[0].freshness).toBe("MISSING");
    expect(report.requirements[0].ageDays).toBeNull();
    expect(report.requirements[0].lastVerifiedAt).toBeNull();
    expect(report.totals.stale).toBe(0);
  });

  it("does not let one passing test speak for six acceptance criteria", async () => {
    const space = await workspace();
    const requirement = await approvedRequirement(space);
    // Six things this requirement claims, written the way the form stores them.
    await prisma.requirement.update({
      where: { id: requirement.id },
      data: {
        acceptanceCriteria: [
          "A saved card appears on the payment step",
          "",
          "Cards are ordered most recently used first",
          "The security code is required",
          "The order confirmation shows the order number",
          "An expired saved card cannot be selected",
          "A guest customer sees no saved cards",
        ].join("\n"),
      },
    });
    const testCase = await linkedTestCase(space, requirement.id, true);
    await recordAttempt(space, testCase.id, "PASSED");

    const report = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));
    const [entry] = report.requirements;

    // Still verified -- a test did pass -- but the reader is told what that
    // does and does not establish, and blank lines are not criteria.
    expect(entry.verdict).toBe("VERIFIED");
    expect(entry.criteriaCount).toBe(6);
    expect(entry.reason).toContain("1 approved test last ran and passed.");
    expect(entry.reason).toContain("states 6 acceptance criteria");
    expect(entry.reason).toContain("do not say which of them those tests cover");
  });

  it("says nothing extra when the tests are not outnumbered by the criteria", async () => {
    const space = await workspace();
    const requirement = await approvedRequirement(space);
    await prisma.requirement.update({
      where: { id: requirement.id },
      data: { acceptanceCriteria: "An order confirmation appears" },
    });
    const testCase = await linkedTestCase(space, requirement.id, true);
    await recordAttempt(space, testCase.id, "PASSED");

    const report = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));
    expect(report.requirements[0].criteriaCount).toBe(1);
    expect(report.requirements[0].reason).toBe("1 approved test last ran and passed.");
  });

  it("counts the approved tests that never ran, beside the ones that did", async () => {
    // Found by reading a shared link as the client would: one requirement,
    // three approved tests, one of them failed and two had never run, and the
    // page said only "1 approved test last ran and did not pass". The same
    // silence on a passing verdict reads as coverage nobody demonstrated.
    const space = await workspace();
    const requirement = await approvedRequirement(space);
    const ran = await linkedTestCase(space, requirement.id, true);
    await linkedTestCase(space, requirement.id, true);
    await linkedTestCase(space, requirement.id, true);
    await recordAttempt(space, ran.id, "PASSED");

    const verified = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));
    expect(verified.requirements[0].verdict).toBe("VERIFIED");
    expect(verified.requirements[0].reason).toContain("1 approved test last ran and passed.");
    expect(verified.requirements[0].reason).toContain("2 more approved tests have never run.");

    await recordAttempt(space, ran.id, "FAILED");
    const failing = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));
    expect(failing.requirements[0].verdict).toBe("FAILING");
    expect(failing.requirements[0].reason).toContain("2 more approved tests have never run.");
  });

  it("says nothing about tests that never ran when every one of them has", async () => {
    const space = await workspace();
    const requirement = await approvedRequirement(space);
    const testCase = await linkedTestCase(space, requirement.id, true);
    await recordAttempt(space, testCase.id, "PASSED");

    const report = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));
    expect(report.requirements[0].reason).not.toContain("never run");
  });

  it("does not call a skipped test a failure", async () => {
    // The dogfood repository went green on 2026-10-11 by skipping its only
    // test: no base URL and no card data in the pipeline. The test line said
    // "could not run" and the verdict beside it said "did not pass", which
    // sends a team hunting a product defect that is really a missing secret.
    const space = await workspace();
    const requirement = await approvedRequirement(space);
    const testCase = await linkedTestCase(space, requirement.id, true);
    await recordAttempt(space, testCase.id, "BLOCKED");

    const report = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));
    const [entry] = report.requirements;

    expect(entry.verdict).toBe("UNVERIFIED");
    expect(entry.reason).toContain("was skipped or could not run");
    expect(entry.reason).toContain("nothing demonstrates the behaviour");
    expect(entry.reason).toContain("an address or a credential");
    expect(entry.reason).not.toContain("did not pass");
    expect(report.totals.failing).toBe(0);
  });

  it("keeps a real failure a failure, and still mentions what was skipped", async () => {
    const space = await workspace();
    const requirement = await approvedRequirement(space);
    const failed = await linkedTestCase(space, requirement.id, true);
    const skipped = await linkedTestCase(space, requirement.id, true);
    await recordAttempt(space, failed.id, "FAILED");
    // A skipped Playwright test is stored as BLOCKED: the attempt result has
    // no SKIPPED of its own.
    await recordAttempt(space, skipped.id, "BLOCKED");

    const report = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));
    const [entry] = report.requirements;

    expect(entry.verdict).toBe("FAILING");
    expect(entry.reason).toContain("1 approved test last ran and did not pass.");
    expect(entry.reason).toContain("1 approved test was skipped or could not run");
  });

  it("does not let a skipped test ride along with a passing one unmentioned", async () => {
    const space = await workspace();
    const requirement = await approvedRequirement(space);
    const passed = await linkedTestCase(space, requirement.id, true);
    const skipped = await linkedTestCase(space, requirement.id, true);
    await recordAttempt(space, passed.id, "PASSED");
    await recordAttempt(space, skipped.id, "BLOCKED");

    const report = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));
    expect(report.requirements[0].verdict).toBe("VERIFIED");
    expect(report.requirements[0].reason).toContain("1 approved test was skipped or could not run");
  });

  it("names who approved the requirement and the test, from the trail", async () => {
    const space = await workspace();
    const requirement = await approvedRequirement(space);
    const testCase = await linkedTestCase(space, requirement.id, true);
    await recordAttempt(space, testCase.id, "PASSED");

    const report = await getReleaseEvidenceReport({ projectId: space.project.id }, deps(space));

    // The sign-off record a reviewing body asks for: a named person and a
    // date, read back from the append-only activity rather than assumed.
    expect(report.requirements[0].approvedBy).toBe("Owner");
    expect(report.requirements[0].approvedAt).toBeInstanceOf(Date);
    expect(report.requirements[0].testCases[0].approvedBy).toBe("Owner");
    expect(report.requirements[0].testCases[0].approvedAt).toBeInstanceOf(Date);
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
