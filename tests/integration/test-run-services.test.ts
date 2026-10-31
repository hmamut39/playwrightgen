import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient, ProjectMembershipRole } from "@/generated/prisma/client";
import { approveTestCase, createTestCase, submitTestCaseForReview } from "@/lib/services/test-cases";
import {
  cancelTestRun,
  createTestRun,
  getTestRunDetail,
  recordTestRunAttempt,
} from "@/lib/services/test-runs";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

describe("tenant-safe immutable Test Runs", () => {
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
    const owner = await prisma.user.create({ data: {
      clerkUserId: unique("owner"), displayName: "Owner",
    } });
    const organization = await prisma.organization.create({ data: {
      clerkOrganizationId: unique("org"), name: "Run workspace", slug: unique("runs"),
    } });
    await prisma.membership.create({ data: {
      organizationId: organization.id, userId: owner.id, role: "OWNER",
    } });
    const project = await prisma.project.create({ data: {
      organizationId: organization.id, name: "Web app", slug: unique("web"),
      createdByUserId: owner.id,
    } });
    return { owner, organization, project };
  }

  const deps = (space: Awaited<ReturnType<typeof workspace>>, actor = space.owner) => ({
    authenticate: async () => ({
      userId: actor.clerkUserId,
      orgId: space.organization.clerkOrganizationId,
    }),
    prisma,
  });

  async function member(space: Awaited<ReturnType<typeof workspace>>, role: ProjectMembershipRole) {
    const user = await prisma.user.create({ data: {
      clerkUserId: unique("member"), displayName: role,
    } });
    await prisma.membership.create({ data: {
      organizationId: space.organization.id, userId: user.id, role: "MEMBER",
    } });
    await prisma.projectMembership.create({ data: {
      organizationId: space.organization.id, projectId: space.project.id,
      userId: user.id, role,
    } });
    return user;
  }

  async function approvedTestCase(space: Awaited<ReturnType<typeof workspace>>) {
    const testCase = await createTestCase({
      projectId: space.project.id,
      title: "Customer signs in",
      objective: "Verify access to the workspace.",
      steps: ["Open sign in", "Submit valid credentials"],
      expectedResults: ["Workspace appears"],
      type: "END_TO_END",
    }, deps(space));
    await submitTestCaseForReview({ projectId: space.project.id, testCaseId: testCase.id }, deps(space));
    await approveTestCase({ projectId: space.project.id, testCaseId: testCase.id }, deps(space));
    return testCase;
  }

  it("pins a run to the approved immutable Test Case version", async () => {
    const space = await workspace();
    const testCase = await approvedTestCase(space);
    const run = await createTestRun({
      projectId: space.project.id, testCaseId: testCase.id,
      name: "Staging sign-in", mode: "PLAYWRIGHT_BROWSER",
      environment: "STAGING", browser: "CHROMIUM", baseUrl: "https://example.com",
    }, deps(space));
    const version = await prisma.testCaseVersion.findUniqueOrThrow({ where: {
      organizationId_projectId_testCaseId_versionNumber: {
        organizationId: space.organization.id, projectId: space.project.id,
        testCaseId: testCase.id, versionNumber: 1,
      },
    } });
    expect(run.testCaseVersionId).toBe(version.id);
    expect(await prisma.activity.count({ where: { action: "TEST_RUN_CREATED", targetId: run.id } })).toBe(1);
  });

  it("rejects runs for draft Test Cases", async () => {
    const space = await workspace();
    const testCase = await createTestCase({
      projectId: space.project.id, title: "Draft", objective: "Draft",
      steps: ["Act"], expectedResults: ["Observe"],
    }, deps(space));
    await expect(createTestRun({
      projectId: space.project.id, testCaseId: testCase.id, name: "Invalid run",
    }, deps(space))).rejects.toMatchObject({ code: "approved_test_case_required" });
  });

  /**
   * The contract the New test run form's error handling rests on.
   *
   * Leaving the test case unchosen was possible -- only the run name carried
   * `required` -- and threw out of here into the workspace error boundary,
   * which told the person "This page didn't load. If you just created your
   * workspace, it may still be finishing setup. Trying again usually works."
   * The workspace was fine, the cause was an empty field nobody was told
   * about, and trying again did the same thing.
   *
   * The page now catches a 400 from here and returns to the form saying
   * which field. If this stops being a 400, that catch silently stops
   * matching and the crash page comes back, so the status is asserted and
   * not only the code.
   */
  it("rejects a run with no test case as a 400, which the form relies on", async () => {
    const space = await workspace();

    await expect(createTestRun({
      projectId: space.project.id, testCaseId: "", name: "Smoke on my machine",
    }, deps(space))).rejects.toMatchObject({ code: "invalid_test_run_input", status: 400 });
  });

  it("rejects a run with no name the same way, rather than storing a blank one", async () => {
    const space = await workspace();
    const testCase = await approvedTestCase(space);

    await expect(createTestRun({
      projectId: space.project.id, testCaseId: testCase.id, name: "",
    }, deps(space))).rejects.toMatchObject({ code: "invalid_test_run_input", status: 400 });
  });

  it("appends immutable evidence attempts and updates only the run aggregate", async () => {
    const space = await workspace();
    const testCase = await approvedTestCase(space);
    const run = await createTestRun({
      projectId: space.project.id, testCaseId: testCase.id, name: "Manual regression",
    }, deps(space));
    const first = await recordTestRunAttempt({
      projectId: space.project.id, testRunId: run.id, expectedAttemptNumber: 0,
      result: "FAILED", durationMs: 1200, summary: "Sign-in did not complete.",
      failureDetails: "The submit request returned an error.",
      stepResults: [{ stepIndex: 1, result: "FAILED", notes: "Request failed" }],
      evidence: [{ kind: "LINK", label: "Failure log", url: "https://example.com/log/1" }],
    }, deps(space));
    await recordTestRunAttempt({
      projectId: space.project.id, testRunId: run.id, expectedAttemptNumber: 1,
      result: "PASSED", durationMs: 900, summary: "Retry passed.",
    }, deps(space));
    const detail = await getTestRunDetail({ projectId: space.project.id, testRunId: run.id }, deps(space));
    expect(detail.testRun.status).toBe("PASSED");
    expect(detail.testRun.latestAttemptNumber).toBe(2);
    expect(detail.testRun.attempts).toHaveLength(2);
    expect(detail.testRun.attempts.find((attempt) => attempt.id === first.id)).toMatchObject({
      result: "FAILED", summary: "Sign-in did not complete.",
    });
  });

  it("rejects a stale concurrent attempt number", async () => {
    const space = await workspace();
    const testCase = await approvedTestCase(space);
    const run = await createTestRun({
      projectId: space.project.id, testCaseId: testCase.id, name: "Conflict",
    }, deps(space));
    const input = {
      projectId: space.project.id, testRunId: run.id,
      expectedAttemptNumber: 0, result: "PASSED" as const,
    };
    await recordTestRunAttempt(input, deps(space));
    await expect(recordTestRunAttempt(input, deps(space))).rejects.toMatchObject({
      code: "test_run_attempt_conflict",
    });
    expect(await prisma.testRunAttempt.count({ where: { testRunId: run.id } })).toBe(1);
  });

  it("allows project Members to execute but reserves cancellation for Leads", async () => {
    const space = await workspace();
    const testCase = await approvedTestCase(space);
    const projectMember = await member(space, "MEMBER");
    const run = await createTestRun({
      projectId: space.project.id, testCaseId: testCase.id, name: "Member run",
    }, deps(space, projectMember));
    await recordTestRunAttempt({
      projectId: space.project.id, testRunId: run.id, expectedAttemptNumber: 0,
      result: "BLOCKED", summary: "Environment unavailable.",
    }, deps(space, projectMember));
    await expect(cancelTestRun({
      projectId: space.project.id, testRunId: run.id,
    }, deps(space, projectMember))).rejects.toMatchObject({ code: "permission_denied" });
    const lead = await member(space, "PROJECT_LEAD");
    await cancelTestRun({ projectId: space.project.id, testRunId: run.id }, deps(space, lead));
    await expect(recordTestRunAttempt({
      projectId: space.project.id, testRunId: run.id, expectedAttemptNumber: 1,
      result: "PASSED",
    }, deps(space, projectMember))).rejects.toMatchObject({ code: "test_run_canceled" });
  });

  it("validates mode-specific browser configuration", async () => {
    const space = await workspace();
    const testCase = await approvedTestCase(space);
    await expect(createTestRun({
      projectId: space.project.id, testCaseId: testCase.id, name: "API run",
      mode: "API", browser: "CHROMIUM",
    }, deps(space))).rejects.toMatchObject({ code: "test_run_browser_not_applicable" });
  });

  it("does not expose runs across tenants", async () => {
    const first = await workspace();
    const second = await workspace();
    const testCase = await approvedTestCase(first);
    const run = await createTestRun({
      projectId: first.project.id, testCaseId: testCase.id, name: "Private run",
    }, deps(first));
    await expect(getTestRunDetail({
      projectId: second.project.id, testRunId: run.id,
    }, deps(second))).rejects.toMatchObject({ code: "test_run_not_found" });
  });
});
