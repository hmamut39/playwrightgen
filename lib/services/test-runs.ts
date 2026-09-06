import "server-only";

import { z } from "zod";

import { webUrlSchema } from "@/lib/validation/url";

import type {
  Prisma,
  TestBrowser,
  TestEnvironment,
  TestRunMode,
  TestRunResult,
} from "@/generated/prisma/client";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
  type WorkspacePermission,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import {
  buildListResult,
  parseListParams,
  type ListParams,
} from "@/lib/services/list-query";

const uuidSchema = z.string().uuid();
const nameSchema = z.string().trim().min(1).max(300);
const textSchema = z.string().trim().max(50_000);
const modeSchema = z.enum(["MANUAL", "PLAYWRIGHT_BROWSER", "API"]);
const environmentSchema = z.enum(["LOCAL", "DEVELOPMENT", "STAGING", "PRODUCTION", "OTHER"]);
const browserSchema = z.enum(["NONE", "CHROMIUM", "FIREFOX", "WEBKIT"]);
const resultSchema = z.enum(["PASSED", "FAILED", "BLOCKED"]);
const nullableUrlSchema = webUrlSchema().nullable();
const stepResultsSchema = z.array(z.object({
  stepIndex: z.number().int().nonnegative(),
  result: z.enum(["PASSED", "FAILED", "BLOCKED", "SKIPPED"]),
  notes: z.string().trim().max(5_000),
})).max(200);
const evidenceSchema = z.array(z.object({
  kind: z.enum(["SCREENSHOT", "VIDEO", "TRACE", "LOG", "LINK"]),
  label: z.string().trim().min(1).max(200),
  url: webUrlSchema(),
})).max(50);

type TestRunDependencies = WorkspaceContextDependencies;

export class TestRunDomainError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409;

  constructor(code: string, status: 400 | 404 | 409) {
    super(code);
    this.name = "TestRunDomainError";
    this.code = code;
    this.status = status;
  }
}

function client(dependencies?: TestRunDependencies) {
  return dependencies?.prisma ?? getPrismaClient();
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new TestRunDomainError("invalid_test_run_input", 400);
  return parsed.data;
}

async function requireProjectContext(
  input: { orgSlug?: string; projectId: string },
  permission: WorkspacePermission,
  dependencies?: TestRunDependencies,
) {
  const projectId = parseOrThrow(uuidSchema, input.projectId);
  const context = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission },
    dependencies,
  );
  return { context, projectId };
}

async function findRunOrThrow(
  transaction: Prisma.TransactionClient,
  input: { organizationId: string; projectId: string; testRunId: string },
) {
  const run = await transaction.testRun.findUnique({
    where: { organizationId_projectId_id: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      id: input.testRunId,
    } },
  });
  if (!run) throw new TestRunDomainError("test_run_not_found", 404);
  return run;
}

function validateModeBrowser(mode: TestRunMode, browser: TestBrowser) {
  if (mode === "API" && browser !== "NONE") {
    throw new TestRunDomainError("test_run_browser_not_applicable", 400);
  }
  if (mode === "PLAYWRIGHT_BROWSER" && browser === "NONE") {
    throw new TestRunDomainError("test_run_browser_required", 400);
  }
}

export function readStepResults(value: Prisma.JsonValue) {
  return stepResultsSchema.safeParse(value).success
    ? stepResultsSchema.parse(value)
    : [];
}

export function readEvidence(value: Prisma.JsonValue) {
  return evidenceSchema.safeParse(value).success
    ? evidenceSchema.parse(value)
    : [];
}

export async function listTestRuns(
  input: { projectId: string; orgSlug?: string } & ListParams,
  dependencies?: TestRunDependencies,
) {
  const { context, projectId } = await requireProjectContext(input, "testrun:read", dependencies);
  const params = parseListParams(input);
  // Searching the run name and the underlying Test Case title, because people
  // look for a run by the behaviour it covers as often as by what it was called.
  const where = {
    organizationId: context.organization.id,
    projectId,
    ...(params.contains
      ? {
          OR: [
            { name: params.contains },
            { testCase: { title: params.contains } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    client(dependencies).testRun.findMany({
      where,
      include: {
        testCase: { select: { id: true, title: true, type: true } },
        testCaseVersion: { select: { id: true, versionNumber: true } },
        createdBy: { select: { id: true, displayName: true } },
        _count: { select: { attempts: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: params.skip,
      take: params.take,
    }),
    client(dependencies).testRun.count({ where }),
  ]);

  return buildListResult(items, total, params);
}

export async function getTestRunDetail(
  input: { projectId: string; testRunId: string; orgSlug?: string },
  dependencies?: TestRunDependencies,
) {
  const testRunId = parseOrThrow(uuidSchema, input.testRunId);
  const { context, projectId } = await requireProjectContext(input, "testrun:read", dependencies);
  const testRun = await client(dependencies).testRun.findUnique({
    where: { organizationId_projectId_id: {
      organizationId: context.organization.id, projectId, id: testRunId,
    } },
    include: {
      testCase: { select: { id: true, title: true, type: true, status: true } },
      testCaseVersion: true,
      createdBy: { select: { id: true, displayName: true } },
      canceledBy: { select: { id: true, displayName: true } },
      attempts: {
        include: { executedBy: { select: { id: true, displayName: true } } },
        orderBy: { attemptNumber: "desc" },
      },
    },
  });
  if (!testRun) throw new TestRunDomainError("test_run_not_found", 404);
  return {
    testRun,
    canRecord: context.can("testrun:record"),
    canCancel: context.can("testrun:cancel"),
    canAnalyzeFailure: context.can("failure:analyze"),
    canResolveFailure: context.can("failure:resolve"),
  };
}

export async function createTestRun(
  input: {
    projectId: string;
    testCaseId: string;
    orgSlug?: string;
    name: string;
    mode?: TestRunMode;
    environment?: TestEnvironment;
    browser?: TestBrowser;
    baseUrl?: string | null;
    requestId?: string;
  },
  dependencies?: TestRunDependencies,
) {
  const data = parseOrThrow(z.object({
    testCaseId: uuidSchema,
    name: nameSchema,
    mode: modeSchema.optional(),
    environment: environmentSchema.optional(),
    browser: browserSchema.optional(),
    baseUrl: nullableUrlSchema.optional(),
  }), input);
  const { context, projectId } = await requireProjectContext(input, "testrun:create", dependencies);
  const mode = data.mode ?? "MANUAL";
  const browser = data.browser ?? (mode === "API" ? "NONE" : "CHROMIUM");
  validateModeBrowser(mode, browser);

  return client(dependencies).$transaction(async (transaction) => {
    const testCase = await transaction.testCase.findUnique({
      where: { organizationId_projectId_id: {
        organizationId: context.organization.id, projectId, id: data.testCaseId,
      } },
    });
    if (!testCase || testCase.status !== "APPROVED") {
      throw new TestRunDomainError("approved_test_case_required", 409);
    }
    const version = await transaction.testCaseVersion.findUnique({
      where: { organizationId_projectId_testCaseId_versionNumber: {
        organizationId: context.organization.id,
        projectId,
        testCaseId: testCase.id,
        versionNumber: testCase.currentVersionNumber,
      } },
    });
    if (!version) throw new TestRunDomainError("test_case_version_not_found", 404);
    const run = await transaction.testRun.create({ data: {
      organizationId: context.organization.id,
      projectId,
      testCaseId: testCase.id,
      testCaseVersionId: version.id,
      name: data.name,
      mode,
      environment: data.environment ?? "DEVELOPMENT",
      browser,
      baseUrl: data.baseUrl ?? null,
      createdByUserId: context.user.id,
    } });
    await transaction.activity.create({ data: {
      organizationId: context.organization.id,
      projectId,
      actorUserId: context.user.id,
      source: "USER",
      action: "TEST_RUN_CREATED",
      targetType: "TEST_RUN",
      targetId: run.id,
      requestId: input.requestId ?? null,
      metadata: {
        testCaseId: testCase.id,
        testCaseVersionId: version.id,
        versionNumber: version.versionNumber,
        mode,
      },
    } });
    return run;
  });
}

export async function recordTestRunAttempt(
  input: {
    projectId: string;
    testRunId: string;
    expectedAttemptNumber: number;
    orgSlug?: string;
    result: TestRunResult;
    durationMs?: number | null;
    summary?: string;
    failureDetails?: string;
    stepResults?: Array<{
      stepIndex: number;
      result: "PASSED" | "FAILED" | "BLOCKED" | "SKIPPED";
      notes: string;
    }>;
    evidence?: Array<{
      kind: "SCREENSHOT" | "VIDEO" | "TRACE" | "LOG" | "LINK";
      label: string;
      url: string;
    }>;
    requestId?: string;
  },
  dependencies?: TestRunDependencies,
) {
  const testRunId = parseOrThrow(uuidSchema, input.testRunId);
  const data = parseOrThrow(z.object({
    expectedAttemptNumber: z.number().int().nonnegative(),
    result: resultSchema,
    durationMs: z.number().int().nonnegative().max(2_147_483_647).nullable().optional(),
    summary: textSchema.optional(),
    failureDetails: textSchema.optional(),
    stepResults: stepResultsSchema.optional(),
    evidence: evidenceSchema.optional(),
  }), input);
  const { context, projectId } = await requireProjectContext(input, "testrun:record", dependencies);
  return client(dependencies).$transaction(async (transaction) => {
    const run = await findRunOrThrow(transaction, {
      organizationId: context.organization.id, projectId, testRunId,
    });
    if (run.status === "CANCELED") throw new TestRunDomainError("test_run_canceled", 409);
    if (run.latestAttemptNumber !== data.expectedAttemptNumber) {
      throw new TestRunDomainError("test_run_attempt_conflict", 409);
    }
    const attemptNumber = run.latestAttemptNumber + 1;
    const update = await transaction.testRun.updateMany({
      where: {
        organizationId: context.organization.id,
        projectId,
        id: testRunId,
        status: { not: "CANCELED" },
        latestAttemptNumber: data.expectedAttemptNumber,
      },
      data: { status: data.result, latestAttemptNumber: attemptNumber },
    });
    if (update.count !== 1) throw new TestRunDomainError("test_run_attempt_conflict", 409);
    const attempt = await transaction.testRunAttempt.create({ data: {
      organizationId: context.organization.id,
      projectId,
      testRunId,
      attemptNumber,
      result: data.result,
      mode: run.mode,
      environment: run.environment,
      browser: run.browser,
      baseUrl: run.baseUrl,
      durationMs: data.durationMs ?? null,
      summary: data.summary ?? "",
      failureDetails: data.failureDetails ?? "",
      stepResults: (data.stepResults ?? []) as Prisma.InputJsonValue,
      evidence: (data.evidence ?? []) as Prisma.InputJsonValue,
      executedByUserId: context.user.id,
    } });
    await transaction.activity.create({ data: {
      organizationId: context.organization.id,
      projectId,
      actorUserId: context.user.id,
      source: "USER",
      action: "TEST_RUN_ATTEMPT_RECORDED",
      targetType: "TEST_RUN_ATTEMPT",
      targetId: attempt.id,
      requestId: input.requestId ?? null,
      metadata: { testRunId, attemptNumber, result: data.result, mode: run.mode },
    } });
    return attempt;
  });
}

export async function cancelTestRun(
  input: { projectId: string; testRunId: string; orgSlug?: string; requestId?: string },
  dependencies?: TestRunDependencies,
) {
  const testRunId = parseOrThrow(uuidSchema, input.testRunId);
  const { context, projectId } = await requireProjectContext(input, "testrun:cancel", dependencies);
  return client(dependencies).$transaction(async (transaction) => {
    const existing = await findRunOrThrow(transaction, {
      organizationId: context.organization.id, projectId, testRunId,
    });
    if (existing.status === "CANCELED") throw new TestRunDomainError("test_run_already_canceled", 409);
    const canceledAt = new Date();
    const update = await transaction.testRun.updateMany({
      where: { organizationId: context.organization.id, projectId, id: testRunId, status: { not: "CANCELED" } },
      data: { status: "CANCELED", canceledAt, canceledByUserId: context.user.id },
    });
    if (update.count !== 1) throw new TestRunDomainError("test_run_already_canceled", 409);
    await transaction.activity.create({ data: {
      organizationId: context.organization.id,
      projectId,
      actorUserId: context.user.id,
      source: "USER",
      action: "TEST_RUN_CANCELED",
      targetType: "TEST_RUN",
      targetId: testRunId,
      requestId: input.requestId ?? null,
      metadata: { fromStatus: existing.status, attemptCount: existing.latestAttemptNumber },
    } });
    return transaction.testRun.findUniqueOrThrow({
      where: { organizationId_projectId_id: {
        organizationId: context.organization.id, projectId, id: testRunId,
      } },
    });
  });
}

export function testRunDomainErrorResponse(error: unknown): Response | null {
  if (!(error instanceof TestRunDomainError)) return null;
  return Response.json({ status: "error", code: error.code }, { status: error.status });
}
