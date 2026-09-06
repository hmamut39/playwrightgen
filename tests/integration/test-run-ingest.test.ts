import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { buildTestCaseVersionMarker } from "@/lib/integrations/runner/ingest-token";
import { classifyRuns } from "@/lib/services/run-signals";
import {
  ingestPlaywrightResults,
  RunIngestError,
  type IngestPayload,
} from "@/lib/services/test-run-ingest";
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
// GitHub identifiers are numeric and the schema enforces `^[0-9]+$`.
const numericId = () => String(Math.floor(Math.random() * 1_000_000_000) + 1);

describe("Playwright result ingestion from customer CI", () => {
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

  async function workspace(withConnection = true) {
    const owner = await prisma.user.create({
      data: { clerkUserId: unique("owner"), displayName: "Owner" },
    });
    const organization = await prisma.organization.create({
      data: {
        clerkOrganizationId: unique("org"),
        name: "Ingest workspace",
        slug: unique("ingest"),
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

    if (withConnection) {
      const installation = await prisma.gitHubInstallation.create({
        data: {
          organizationId: organization.id,
          externalInstallationId: numericId(),
          accountId: "1",
          accountLogin: "acme",
          accountType: "User",
          repositorySelection: "selected",
          connectedByUserId: owner.id,
        },
      });
      await prisma.repositoryConnection.create({
        data: {
          organizationId: organization.id,
          projectId: project.id,
          githubInstallationId: installation.id,
          externalRepositoryId: numericId(),
          ownerLogin: "acme",
          name: "web",
          fullName: "acme/web",
          defaultBranch: "main",
          visibility: "PUBLIC",
          status: "ACTIVE",
          createdByUserId: owner.id,
        },
      });
    }

    return { owner, organization, project };
  }

  const deps = (space: Awaited<ReturnType<typeof workspace>>) => ({
    authenticate: async () => ({
      userId: space.owner.clerkUserId,
      orgId: space.organization.clerkOrganizationId,
    }),
    prisma,
  });

  /** Produces an approved Test Case and returns its pinned immutable version id. */
  async function approvedVersion(space: Awaited<ReturnType<typeof workspace>>) {
    const record = await createTestCase({
      projectId: space.project.id,
      title: "Customer completes checkout",
      objective: "A signed-in customer can place an order.",
      preconditions: "A product is in stock.",
      steps: ["Open the cart", "Submit valid payment"],
      expectedResults: ["Order confirmation is displayed"],
      priority: "HIGH",
      type: "END_TO_END",
      tags: ["checkout"],
    }, deps(space));
    await submitTestCaseForReview({ projectId: space.project.id, testCaseId: record.id }, deps(space));
    await approveTestCase({ projectId: space.project.id, testCaseId: record.id }, deps(space));

    const version = await prisma.testCaseVersion.findFirst({
      where: { organizationId: space.organization.id, projectId: space.project.id, testCaseId: record.id },
      orderBy: { versionNumber: "desc" },
      select: { id: true },
    });
    if (!version) throw new Error("expected an approved version");
    return { testCaseId: record.id, versionId: version.id };
  }

  function payload(
    space: Awaited<ReturnType<typeof workspace>>,
    title: string,
    overrides: Partial<IngestPayload> = {},
  ): IngestPayload {
    return {
      organizationId: space.organization.id,
      projectId: space.project.id,
      run: {
        provider: "github_actions",
        externalId: "9001-1",
        url: "https://github.com/acme/web/actions/runs/9001",
        commitSha: "a".repeat(40),
        ref: "main",
      },
      environment: "DEVELOPMENT",
      browser: "CHROMIUM",
      baseUrl: null,
      results: [{
        title,
        status: "failed",
        durationMs: 4200,
        errorMessage: "expect(received).toBeVisible()",
        steps: [
          { title: "open the cart", status: "passed" },
          { title: "submit payment", status: "failed" },
        ],
      }],
      ...overrides,
    };
  }

  it("records a CI result as immutable evidence pinned to the approved version", async () => {
    const space = await workspace();
    const { testCaseId, versionId } = await approvedVersion(space);
    const title = `${buildTestCaseVersionMarker(versionId)} checkout succeeds`;

    const summary = await ingestPlaywrightResults(payload(space, title), { prisma });

    expect(summary).toEqual({ recorded: 1, duplicates: 0, unmatched: 0 });

    const run = await prisma.testRun.findFirst({
      where: { organizationId: space.organization.id, projectId: space.project.id },
      include: { attempts: true },
    });
    expect(run?.testCaseId).toBe(testCaseId);
    expect(run?.testCaseVersionId).toBe(versionId);
    expect(run?.status).toBe("FAILED");
    expect(run?.mode).toBe("PLAYWRIGHT_BROWSER");
    expect(run?.latestAttemptNumber).toBe(1);

    const attempt = run?.attempts[0];
    expect(attempt).toMatchObject({ result: "FAILED", attemptNumber: 1, durationMs: 4200 });
    expect(attempt?.failureDetails).toContain("toBeVisible");
    expect(attempt?.executedByUserId).toBe(space.owner.id);
    expect(attempt?.stepResults).toEqual([
      { stepIndex: 0, result: "PASSED", notes: "open the cart" },
      { stepIndex: 1, result: "FAILED", notes: "submit payment" },
    ]);
    expect(attempt?.evidence).toEqual([
      { kind: "LINK", label: "CI run 9001-1", url: "https://github.com/acme/web/actions/runs/9001" },
    ]);

    const activity = await prisma.activity.findFirst({
      where: { action: "TEST_RUN_ATTEMPT_RECORDED" },
    });
    expect(activity?.source).toBe("SYSTEM");
  });

  it("treats a replayed workflow run as a duplicate rather than new evidence", async () => {
    const space = await workspace();
    const { versionId } = await approvedVersion(space);
    const title = `${buildTestCaseVersionMarker(versionId)} checkout succeeds`;

    await ingestPlaywrightResults(payload(space, title), { prisma });
    const replay = await ingestPlaywrightResults(payload(space, title), { prisma });

    expect(replay).toEqual({ recorded: 0, duplicates: 1, unmatched: 0 });
    expect(await prisma.testRunAttempt.count()).toBe(1);
  });

  it("appends a second attempt for a genuinely different workflow run", async () => {
    const space = await workspace();
    const { versionId } = await approvedVersion(space);
    const title = `${buildTestCaseVersionMarker(versionId)} checkout succeeds`;

    await ingestPlaywrightResults(payload(space, title), { prisma });
    const second = payload(space, title);
    second.run.externalId = "9002-1";
    second.run.url = "https://github.com/acme/web/actions/runs/9002";
    second.results[0].status = "passed";
    await ingestPlaywrightResults(second, { prisma });

    const run = await prisma.testRun.findFirst({ include: { attempts: { orderBy: { attemptNumber: "asc" } } } });
    expect(run?.latestAttemptNumber).toBe(2);
    expect(run?.status).toBe("PASSED");
    expect(run?.attempts.map((a) => a.result)).toEqual(["FAILED", "PASSED"]);
  });

  it("records the source revision so flakiness can be told from regression", async () => {
    const space = await workspace();
    const { versionId } = await approvedVersion(space);
    const title = `${buildTestCaseVersionMarker(versionId)} checkout succeeds`;

    // Same approved version, same commit, opposite outcomes: an unreliable test.
    await ingestPlaywrightResults(payload(space, title), { prisma });
    const rerun = payload(space, title);
    rerun.run.externalId = "9001-2";
    rerun.run.url = "https://github.com/acme/web/actions/runs/9001?attempt=2";
    rerun.results[0].status = "passed";
    await ingestPlaywrightResults(rerun, { prisma });

    const attempts = await prisma.testRunAttempt.findMany({
      select: {
        testRunId: true,
        attemptNumber: true,
        result: true,
        commitSha: true,
        sourceRef: true,
        executedAt: true,
        testRun: { select: { testCaseId: true, testCaseVersionId: true } },
      },
      orderBy: { attemptNumber: "asc" },
    });

    expect(attempts).toHaveLength(2);
    expect(attempts[0].commitSha).toBe("a".repeat(40));
    expect(attempts[0].sourceRef).toBe("main");

    const signals = classifyRuns(
      attempts.map((a) => ({
        testRunId: a.testRunId,
        testCaseId: a.testRun.testCaseId,
        testCaseVersionId: a.testRun.testCaseVersionId,
        attemptNumber: a.attemptNumber,
        result: a.result,
        commitSha: a.commitSha,
        executedAt: a.executedAt,
      })),
    );

    // The latest attempt passed, so the run reads as passing; the flaky verdict
    // appears when the newest attempt is the failing one. It is not "stable"
    // because both attempts are on one commit, which says nothing about whether
    // the behaviour survives a change.
    expect(signals.get(attempts[0].testRunId)?.signal).toBe("PASSING");
  });

  it("classifies a failure on a newer commit as a regression, not flakiness", async () => {
    const space = await workspace();
    const { versionId } = await approvedVersion(space);
    const title = `${buildTestCaseVersionMarker(versionId)} checkout succeeds`;

    const first = payload(space, title);
    first.results[0].status = "passed";
    await ingestPlaywrightResults(first, { prisma });

    const second = payload(space, title);
    second.run.externalId = "9002-1";
    second.run.url = "https://github.com/acme/web/actions/runs/9002";
    second.run.commitSha = "b".repeat(40);
    await ingestPlaywrightResults(second, { prisma });

    const attempts = await prisma.testRunAttempt.findMany({
      select: {
        testRunId: true,
        attemptNumber: true,
        result: true,
        commitSha: true,
        executedAt: true,
        testRun: { select: { testCaseId: true, testCaseVersionId: true } },
      },
    });

    const signals = classifyRuns(
      attempts.map((a) => ({
        testRunId: a.testRunId,
        testCaseId: a.testRun.testCaseId,
        testCaseVersionId: a.testRun.testCaseVersionId,
        attemptNumber: a.attemptNumber,
        result: a.result,
        commitSha: a.commitSha,
        executedAt: a.executedAt,
      })),
    );

    const verdict = signals.get(attempts[0].testRunId);
    expect(verdict?.signal).toBe("REGRESSION");
    expect(verdict?.detail).toContain("in the application");
  });

  it("reports unmatched results instead of inventing evidence", async () => {
    const space = await workspace();
    await approvedVersion(space);

    const unknownVersion = `${buildTestCaseVersionMarker("55555555-5555-4555-8555-555555555555")} orphan`;
    const summary = await ingestPlaywrightResults(payload(space, unknownVersion), { prisma });

    expect(summary).toEqual({ recorded: 0, duplicates: 0, unmatched: 1 });
    expect(await prisma.testRunAttempt.count()).toBe(0);
  });

  it("ignores unmarked tests so a customer's other specs create no evidence", async () => {
    const space = await workspace();
    await approvedVersion(space);

    const summary = await ingestPlaywrightResults(payload(space, "some unrelated spec"), { prisma });

    expect(summary).toEqual({ recorded: 0, duplicates: 0, unmatched: 1 });
    expect(await prisma.testRun.count()).toBe(0);
  });

  it("fails closed when the repository connection is not active", async () => {
    const space = await workspace(false);
    const { versionId } = await approvedVersion(space);
    const title = `${buildTestCaseVersionMarker(versionId)} checkout succeeds`;

    await expect(
      ingestPlaywrightResults(payload(space, title), { prisma }),
    ).rejects.toMatchObject({ code: "repository_connection_inactive", status: 403 });
  });

  it("cannot write evidence into another tenant's project", async () => {
    const space = await workspace();
    const foreign = await workspace();
    const { versionId } = await approvedVersion(foreign);
    const title = `${buildTestCaseVersionMarker(versionId)} checkout succeeds`;

    // A payload naming one organization but another organization's project must
    // not resolve, even though both exist and both have active connections.
    const crossTenant = payload(space, title, { projectId: foreign.project.id });

    await expect(
      ingestPlaywrightResults(crossTenant, { prisma }),
    ).rejects.toBeInstanceOf(RunIngestError);
    expect(await prisma.testRunAttempt.count()).toBe(0);
  });
});
