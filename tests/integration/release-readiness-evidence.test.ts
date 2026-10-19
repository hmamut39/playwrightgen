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

  /**
   * Found on 2026-10-19, walking a mock company to its release page. Three of
   * its tests had passed on the live page the day before -- every Test Case
   * said so, in those words -- and the release page said "Nothing has ever
   * been run for this project".
   *
   * Keeping live-page runs out of release evidence is right: they prove the
   * code against the page at a moment, not the release against an approved
   * version. Saying nothing had run was not right, and it left the lead with
   * no idea what would count instead.
   */
  it("does not claim nothing has run when live-page runs exist", async () => {
    const space = await workspace();
    const d = deps(space);
    const testCase = await createTestCase({
      projectId: space.project.id,
      title: "A todo can be added",
      objective: "Verify a todo appears after submitting.",
      steps: ["Type a todo", "Press Enter"],
      expectedResults: ["The todo appears"],
    }, d);
    await prisma.testCaseImportedDraft.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        testCaseId: testCase.id,
        source: "page-coverage",
        code: "import { test } from '@playwright/test';",
        pageUrl: "https://demo.playwright.dev/todomvc/",
        runEvidence: {
          v: 1,
          codeSha256: "a".repeat(64),
          pageUrl: "https://demo.playwright.dev/todomvc/",
          verdict: "passed",
          passed: 10,
          failed: 0,
          skipped: 0,
          notReached: 0,
          tests: 1,
          durationMs: 3200,
          ranAt: "2026-10-18T20:43:00.000Z",
        },
        importedByUserId: space.owner.id,
      },
    });

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, d);
    const blocker = readiness.findings.find((f) => f.code === "evidence_missing");

    // Still blocked: a live-page run is not release evidence.
    expect(blocker).toBeDefined();
    expect(readiness.releasable).toBe(false);
    // But it no longer says nothing has run, and it says what would count.
    expect(blocker?.detail).not.toContain("Nothing has ever been run");
    expect(blocker?.detail).toContain("passed on the live page");
    expect(blocker?.detail).toMatch(/pipeline|Test Run is recorded/);
  });

  it("still says nothing has run when nothing has", async () => {
    // Without this, the change above could have replaced one fixed sentence
    // with another fixed sentence.
    const space = await workspace();
    const d = deps(space);
    await createTestCase({
      projectId: space.project.id,
      title: "Untouched",
      objective: "Nothing has run for this one.",
      steps: ["Do nothing"],
      expectedResults: ["Nothing"],
    }, d);

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, d);
    const blocker = readiness.findings.find((f) => f.code === "evidence_missing");

    expect(blocker?.detail).toContain("Nothing has ever been run");
  });

  /**
   * Found on 2026-10-19 by breaking a mock company's site under its own
   * approved suite. Three approved tests failed on the live page every day, a
   * product-defect finding was confirmed at 70%, and this page said "Nothing
   * is blocking this release".
   *
   * `regressions` answers a narrower question -- which failures can be pinned
   * on the application -- and that needs a commit hash on both sides. A daily
   * live check runs against an address, not a revision, so it has none, and
   * the `NEW_FAILURE` and `INSUFFICIENT` signals were classified and then
   * dropped. Nothing else on the page counted a failure at all.
   *
   * The attribution question is worth keeping. Asking it first was the
   * mistake.
   */
  it("blocks while an approved test is failing, even with nothing to blame", async () => {
    const space = await workspace();
    const d = deps(space);
    const testCase = await createTestCase({
      projectId: space.project.id,
      title: "A todo can be added",
      objective: "Verify a todo appears after submitting.",
      steps: ["Type a todo", "Press Enter"],
      expectedResults: ["The todo appears"],
    }, d);
    await submitTestCaseForReview({ projectId: space.project.id, testCaseId: testCase.id }, d);
    await approveTestCase({ projectId: space.project.id, testCaseId: testCase.id }, d);
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
        name: "Daily live check",
        status: "FAILED",
        latestAttemptNumber: 1,
        createdByUserId: space.owner.id,
      },
    });
    // No commitSha, exactly as a daily live check records it.
    await prisma.testRunAttempt.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        testRunId: testRun.id,
        attemptNumber: 1,
        result: "FAILED",
        mode: "PLAYWRIGHT_BROWSER",
        environment: "PRODUCTION",
        browser: "CHROMIUM",
        summary: "Daily live check: 0 passed, 1 failed.",
        failureDetails: "locator.waitFor: Timeout 5000ms exceeded.",
        stepResults: [],
        evidence: [],
        executedByUserId: space.owner.id,
      },
    });

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, d);
    const blocker = readiness.findings.find((f) => f.code === "tests_failing");

    expect(blocker).toBeDefined();
    expect(blocker?.severity).toBe("BLOCKER");
    expect(blocker?.count).toBe(1);
    expect(readiness.releasable).toBe(false);
    // It must not claim to know whose fault it is: that is the regression
    // finding's job, and it has the commit evidence this one does not.
    expect(blocker?.detail).toMatch(/separate question|not be settled/i);
    expect(readiness.findings.some((f) => f.code === "regressions_open")).toBe(false);
  });

  it("does not raise it when the approved tests are passing", async () => {
    // Without this the blocker could fire unconditionally, which would
    // satisfy the case above while making the page useless.
    const space = await workspace();
    const d = deps(space);
    const testCase = await createTestCase({
      projectId: space.project.id,
      title: "A todo can be added",
      objective: "Verify a todo appears after submitting.",
      steps: ["Type a todo", "Press Enter"],
      expectedResults: ["The todo appears"],
    }, d);
    await submitTestCaseForReview({ projectId: space.project.id, testCaseId: testCase.id }, d);
    await approveTestCase({ projectId: space.project.id, testCaseId: testCase.id }, d);
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
        name: "Daily live check",
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
        mode: "PLAYWRIGHT_BROWSER",
        environment: "PRODUCTION",
        browser: "CHROMIUM",
        summary: "Daily live check: 1 passed.",
        failureDetails: "",
        stepResults: [],
        evidence: [],
        executedByUserId: space.owner.id,
      },
    });

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, d);
    expect(readiness.findings.some((f) => f.code === "tests_failing")).toBe(false);
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

  it("tells a project with stale evidence what would keep it current", async () => {
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

    // Forty-five days pass and nobody touches the project. Every timestamp the
    // freshness clock reads has to move, not only the run: approving a
    // document counts as activity too, which is why raw statements are used --
    // Prisma keeps updatedAt current on its own.
    const longAgo = new Date(Date.now() - 45 * 86_400_000);
    const id = space.project.id;
    await prisma.$executeRaw`UPDATE "Requirement" SET "updatedAt" = ${longAgo}, "approvedAt" = ${longAgo} WHERE "projectId" = ${id}::uuid`;
    await prisma.$executeRaw`UPDATE "TestCase" SET "updatedAt" = ${longAgo}, "approvedAt" = ${longAgo} WHERE "projectId" = ${id}::uuid`;
    await prisma.$executeRaw`UPDATE "TestRunAttempt" SET "executedAt" = ${longAgo} WHERE "projectId" = ${id}::uuid`;

    const stale = await getReleaseReadiness({ projectId: id }, d);
    const finding = stale.findings.find((entry) => entry.code === "evidence_stale");
    expect(finding).toBeDefined();
    // Naming the problem again is no use; the switch that fixes it is.
    expect(finding?.detail).toContain("Daily checks would run the approved automation every day");
    expect(finding?.detail).toContain("once this project says where it runs");
    expect(finding?.href).toContain("/overview#live-checks");
    // A caution, not a blocker: old evidence is still evidence.
    expect(finding?.severity).toBe("CAUTION");

    // With the checks already on, stale evidence means something else, and
    // sending the reader back to the switch would be wrong.
    await prisma.project.update({
      where: { id },
      data: { liveUrl: "https://example.com", liveChecksEnabled: true },
    });
    const running = await getReleaseReadiness({ projectId: id }, d);
    const second = running.findings.find((entry) => entry.code === "evidence_stale");
    expect(second?.detail).toContain("Daily checks are on");
    expect(second?.href).toContain("/test-runs");
  });

  it("blocks an entirely empty project", async () => {
    const space = await workspace();

    const readiness = await getReleaseReadiness({ projectId: space.project.id }, deps(space));

    expect(readiness.releasable).toBe(false);
  });
});
