import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { FailureCategory, PrismaClient } from "@/generated/prisma/client";
import { readRepairReadiness } from "@/lib/services/automation-repair";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

/**
 * The decision this makes is the whole feature. Repairing a test that caught
 * a real defect would delete the warning, which is worse than not offering a
 * repair at all.
 */
describe("whether a failing test may be repaired", () => {
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

  async function space() {
    const owner = await prisma.user.create({ data: { clerkUserId: unique("owner"), displayName: "Lead" } });
    const organization = await prisma.organization.create({
      data: { clerkOrganizationId: unique("org"), name: "Shop", slug: unique("shop") },
    });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
    const project = await prisma.project.create({
      data: { organizationId: organization.id, name: "Checkout", slug: unique("p"), createdByUserId: owner.id },
    });
    const testCase = await prisma.testCase.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        title: "Pay with a saved card",
        objective: "It completes.",
        preconditions: "",
        steps: ["Pay"],
        expectedResults: ["Confirmed"],
        status: "APPROVED",
        ownerUserId: owner.id,
        createdByUserId: owner.id,
        currentVersionNumber: 1,
      },
    });
    const version = await prisma.testCaseVersion.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        testCaseId: testCase.id,
        versionNumber: 1,
        title: testCase.title,
        objective: testCase.objective,
        preconditions: "",
        steps: ["Pay"],
        expectedResults: ["Confirmed"],
        priority: "MEDIUM",
        type: "FUNCTIONAL",
        source: "MANUAL",
        tags: [],
        automationStatus: "MANUAL",
        ownerUserId: owner.id,
        createdByUserId: owner.id,
      },
    });
    const run = await prisma.testRun.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        testCaseId: testCase.id,
        testCaseVersionId: version.id,
        name: "Daily check",
        status: "FAILED",
        latestAttemptNumber: 1,
        createdByUserId: owner.id,
      },
    });
    const attempt = await prisma.testRunAttempt.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        testRunId: run.id,
        attemptNumber: 1,
        result: "FAILED",
        mode: "PLAYWRIGHT_BROWSER",
        environment: "STAGING",
        browser: "CHROMIUM",
        summary: "It failed.",
        failureDetails: "Timeout waiting for the confirmation.",
        stepResults: [],
        evidence: [],
        executedByUserId: owner.id,
      },
    });
    const owned = {
      authenticate: async () => ({ userId: owner.clerkUserId, orgId: organization.clerkOrganizationId }),
      prisma,
    };
    return { owner, organization, project, testCase, run, attempt, owned };
  }

  async function diagnose(
    area: Awaited<ReturnType<typeof space>>,
    category: FailureCategory,
    confidence: number,
  ) {
    const analysis = await prisma.failureAnalysis.create({
      data: {
        organizationId: area.organization.id,
        projectId: area.project.id,
        testRunId: area.run.id,
        testRunAttemptId: area.attempt.id,
        summary: "Analysed.",
        model: "test-model",
        promptVersion: "1",
        schemaVersion: "1",
        createdByUserId: area.owner.id,
      },
    });
    await prisma.failureFinding.create({
      data: {
        organizationId: area.organization.id,
        projectId: area.project.id,
        testRunId: area.run.id,
        testRunAttemptId: area.attempt.id,
        failureAnalysisId: analysis.id,
        category,
        confidence,
        title: `${category} finding`,
        explanation: "Because.",
        evidenceField: "failureDetails",
        evidenceQuote: "Timeout waiting for the confirmation.",
        recommendation: "Do something.",
      },
    });
  }

  it("refuses when the product is what looks broken", async () => {
    const area = await space();
    await diagnose(area, "PRODUCT_DEFECT", 85);

    const readiness = await readRepairReadiness(
      { projectId: area.project.id, testCaseId: area.testCase.id },
      area.owned,
    );

    expect(readiness.allowed).toBe(false);
    // The reason is said out loud, because a button that silently declines
    // teaches nobody anything.
    expect(readiness.message).toContain("defect in the product");
    expect(readiness.message).toContain("delete the only warning");
  });

  it("offers a repair when the test itself is what looks wrong", async () => {
    const area = await space();
    await diagnose(area, "TEST_DEFECT", 80);

    const readiness = await readRepairReadiness(
      { projectId: area.project.id, testCaseId: area.testCase.id },
      area.owned,
    );

    expect(readiness).toMatchObject({ allowed: true, category: "TEST_DEFECT", confidence: 80 });
    expect(readiness.message).toContain("A person still reviews it");
  });

  it("will not act on a diagnosis it is not confident about", async () => {
    const area = await space();
    await diagnose(area, "TEST_DEFECT", 40);

    const readiness = await readRepairReadiness(
      { projectId: area.project.id, testCaseId: area.testCase.id },
      area.owned,
    );

    expect(readiness.allowed).toBe(false);
    expect(readiness.message).toContain("not confident");
  });

  it("does nothing until something has analysed the failure", async () => {
    const area = await space();

    const readiness = await readRepairReadiness(
      { projectId: area.project.id, testCaseId: area.testCase.id },
      area.owned,
    );

    expect(readiness.allowed).toBe(false);
    expect(readiness.message).toContain("Nothing has analysed this failure yet");
  });

  it("leaves the environment and the test data to a person", async () => {
    for (const category of ["ENVIRONMENT", "TEST_DATA", "DEPENDENCY", "UNKNOWN"] as const) {
      const area = await space();
      await diagnose(area, category, 90);
      const readiness = await readRepairReadiness(
        { projectId: area.project.id, testCaseId: area.testCase.id },
        area.owned,
      );
      expect(readiness.allowed).toBe(false);
      expect(readiness.message).toContain("only offered when the test itself");
    }
  });
});
