import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient, ProjectMembershipRole } from "@/generated/prisma/client";
import type {
  FailureAnalysisEvidence,
  FailureAnalysisResult,
} from "@/lib/ai/failure-analysis";
import { approveTestCase, createTestCase, submitTestCaseForReview } from "@/lib/services/test-cases";
import {
  listFailureAnalyses,
  resolveFailureFinding,
  runFailureAnalysis,
} from "@/lib/services/failure-intelligence";
import { createTestRun, recordTestRunAttempt } from "@/lib/services/test-runs";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

describe("tenant-safe Failure Intelligence", () => {
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
    const owner = await prisma.user.create({ data: { clerkUserId: unique("owner"), displayName: "Owner" } });
    const organization = await prisma.organization.create({ data: {
      clerkOrganizationId: unique("org"), name: "Failure workspace", slug: unique("failure"),
    } });
    await prisma.membership.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
    const project = await prisma.project.create({ data: {
      organizationId: organization.id, name: "Checkout", slug: unique("checkout"), createdByUserId: owner.id,
    } });
    return { owner, organization, project };
  }

  const deps = (
    space: Awaited<ReturnType<typeof workspace>>,
    actor = space.owner,
    analyzer?: () => Promise<FailureAnalysisResult>,
  ) => ({
    authenticate: async () => ({ userId: actor.clerkUserId, orgId: space.organization.clerkOrganizationId }),
    prisma,
    ...(analyzer ? { analyzer } : {}),
  });

  async function addMember(space: Awaited<ReturnType<typeof workspace>>, role: ProjectMembershipRole) {
    const user = await prisma.user.create({ data: { clerkUserId: unique("member"), displayName: role } });
    await prisma.membership.create({ data: { organizationId: space.organization.id, userId: user.id, role: "MEMBER" } });
    await prisma.projectMembership.create({ data: {
      organizationId: space.organization.id, projectId: space.project.id, userId: user.id, role,
    } });
    return user;
  }

  async function failedAttempt(space: Awaited<ReturnType<typeof workspace>>, result: "FAILED" | "PASSED" = "FAILED") {
    const testCase = await createTestCase({
      projectId: space.project.id, title: "Customer checks out",
      objective: "A customer can place an order.", steps: ["Open cart", "Submit order"],
      expectedResults: ["Order confirmation appears"],
    }, deps(space));
    await submitTestCaseForReview({ projectId: space.project.id, testCaseId: testCase.id }, deps(space));
    await approveTestCase({ projectId: space.project.id, testCaseId: testCase.id }, deps(space));
    const run = await createTestRun({
      projectId: space.project.id, testCaseId: testCase.id, name: "Checkout run",
    }, deps(space));
    const attempt = await recordTestRunAttempt({
      projectId: space.project.id, testRunId: run.id, expectedAttemptNumber: 0,
      result, summary: result === "FAILED" ? "Checkout returned a server error." : "Checkout passed.",
      failureDetails: result === "FAILED" ? "POST /orders returned HTTP 500." : "",
      stepResults: [{ stepIndex: 1, result, notes: result === "FAILED" ? "submit failed" : "" }],
    }, deps(space));
    return { run, attempt };
  }

  const validResult = (): FailureAnalysisResult => ({
    model: "test-model", inputTokens: 10, outputTokens: 20, totalTokens: 30,
    summary: "The order request failed during submission.",
    findings: [{
      category: "PRODUCT_DEFECT", confidence: 75, title: "Order endpoint failed",
      explanation: "The captured response shows a server error.",
      evidenceField: "FAILURE_DETAILS", evidenceQuote: "POST /orders returned HTTP 500.",
      recommendation: "Inspect order-service logs correlated to this attempt.",
    }],
  });

  /** Captures the evidence handed to the analyzer so it can be asserted on. */
  function capturingDeps(space: Awaited<ReturnType<typeof workspace>>) {
    const seen: FailureAnalysisEvidence[] = [];
    return {
      seen,
      deps: {
        authenticate: async () => ({
          userId: space.owner.clerkUserId,
          orgId: space.organization.clerkOrganizationId,
        }),
        prisma,
        analyzer: async (evidence: FailureAnalysisEvidence) => {
          seen.push(evidence);
          return validResult();
        },
      },
    };
  }

  it("tells the analyzer a regression is the application, not flakiness", async () => {
    const space = await workspace();
    const { run, attempt } = await failedAttempt(space);

    // The first attempt becomes a pass on an earlier revision, and the failure
    // under analysis becomes the latest attempt on a newer revision. That
    // ordering is what separates an application regression from a flaky test.
    await prisma.testRunAttempt.update({
      where: { id: attempt.id },
      data: {
        result: "PASSED",
        commitSha: "a".repeat(40),
        sourceRef: "main",
        executedAt: new Date(Date.now() - 60_000),
      },
    });
    const failing = await prisma.testRunAttempt.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        testRunId: run.id,
        attemptNumber: 2,
        result: "FAILED",
        mode: "MANUAL",
        environment: "DEVELOPMENT",
        browser: "NONE",
        summary: "Checkout returned a server error.",
        failureDetails: "POST /orders returned HTTP 500.",
        stepResults: [],
        evidence: [],
        commitSha: "b".repeat(40),
        sourceRef: "main",
        executedByUserId: space.owner.id,
      },
    });
    await prisma.testRun.update({
      where: { id: run.id },
      data: { latestAttemptNumber: 2, status: "FAILED" },
    });

    const { seen, deps: capturing } = capturingDeps(space);
    await runFailureAnalysis({
      projectId: space.project.id,
      testRunId: run.id,
      testRunAttemptId: failing.id,
    }, capturing);

    expect(seen).toHaveLength(1);
    const history = seen[0].EXECUTION_HISTORY;
    expect(history).toContain("REGRESSION");
    expect(history).toContain("in the application");
    expect(history).toContain("recorded attempt");
  });

  it("tells the analyzer plainly when there is no prior evidence to compare", async () => {
    const space = await workspace();
    const { run, attempt } = await failedAttempt(space);

    const { seen, deps: capturing } = capturingDeps(space);
    await runFailureAnalysis({
      projectId: space.project.id,
      testRunId: run.id,
      testRunAttemptId: attempt.id,
    }, capturing);

    // A single manual attempt carries no revision, so neither flakiness nor
    // regression is established and the model must not be nudged toward either.
    const history = seen[0].EXECUTION_HISTORY;
    expect(history).toContain("NEW_FAILURE");
    expect(history).not.toContain("REGRESSION");
    expect(history).not.toContain("FLAKY");
  });

  it("persists evidence-bound findings, provider metadata, and Activity", async () => {
    const space = await workspace();
    const { run, attempt } = await failedAttempt(space);
    const analysis = await runFailureAnalysis({
      projectId: space.project.id, testRunId: run.id, testRunAttemptId: attempt.id,
    }, deps(space, space.owner, async () => validResult()));
    expect(analysis).toMatchObject({ status: "SUCCEEDED", model: "test-model", totalTokens: 30 });
    expect(analysis.findings[0]).toMatchObject({ category: "PRODUCT_DEFECT", confidence: 75, status: "OPEN" });
    expect(await prisma.activity.count({ where: { action: "FAILURE_ANALYSIS_COMPLETED", targetId: analysis.id } })).toBe(1);
  });

  it("stores a safe failed analysis when local evidence validation rejects output", async () => {
    const space = await workspace();
    const { run, attempt } = await failedAttempt(space);
    const invalid = validResult();
    invalid.findings[0].evidenceQuote = "invented database timeout";
    await expect(runFailureAnalysis({
      projectId: space.project.id, testRunId: run.id, testRunAttemptId: attempt.id,
    }, deps(space, space.owner, async () => invalid))).rejects.toMatchObject({ code: "failure_analysis_failed" });
    const analysis = await prisma.failureAnalysis.findFirstOrThrow();
    expect(analysis).toMatchObject({ status: "FAILED", failureCode: "invalid_output" });
    expect(await prisma.failureFinding.count()).toBe(0);
  });

  it("rejects analysis of passing attempts", async () => {
    const space = await workspace();
    const { run, attempt } = await failedAttempt(space, "PASSED");
    await expect(runFailureAnalysis({
      projectId: space.project.id, testRunId: run.id, testRunAttemptId: attempt.id,
    }, deps(space, space.owner, async () => validResult()))).rejects.toMatchObject({ code: "failed_attempt_required" });
  });

  it("lets Members analyze while Leads confirm or dismiss findings", async () => {
    const space = await workspace();
    const { run, attempt } = await failedAttempt(space);
    const projectMember = await addMember(space, "MEMBER");
    const analysis = await runFailureAnalysis({
      projectId: space.project.id, testRunId: run.id, testRunAttemptId: attempt.id,
    }, deps(space, projectMember, async () => validResult()));
    await expect(resolveFailureFinding({
      projectId: space.project.id, testRunId: run.id,
      findingId: analysis.findings[0].id, resolution: "CONFIRMED",
    }, deps(space, projectMember))).rejects.toMatchObject({ code: "permission_denied" });
    const lead = await addMember(space, "PROJECT_LEAD");
    const finding = await resolveFailureFinding({
      projectId: space.project.id, testRunId: run.id,
      findingId: analysis.findings[0].id, resolution: "CONFIRMED",
    }, deps(space, lead));
    expect(finding.status).toBe("CONFIRMED");
  });

  it("does not expose analyses across tenants", async () => {
    const first = await workspace();
    const second = await workspace();
    const { run, attempt } = await failedAttempt(first);
    await runFailureAnalysis({
      projectId: first.project.id, testRunId: run.id, testRunAttemptId: attempt.id,
    }, deps(first, first.owner, async () => validResult()));
    expect(await listFailureAnalyses({
      projectId: second.project.id, testRunId: run.id,
    }, deps(second))).toEqual([]);
  });
});
