import "server-only";

import { z } from "zod";

import type {
  AutomationStatus,
  Prisma,
  TestCasePriority,
  TestCaseSource,
  TestCaseStatus,
  TestCaseType,
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
const titleSchema = z.string().trim().min(1).max(300);
const textSchema = z.string().trim().max(50_000);
const listSchema = z.array(z.string().trim().min(1).max(2_000)).max(200);
const tagsSchema = z.array(z.string().trim().min(1).max(50)).max(30);
const versionSchema = z.number().int().positive();
const prioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
const typeSchema = z.enum([
  "FUNCTIONAL",
  "END_TO_END",
  "API",
  "INTEGRATION",
  "REGRESSION",
]);
const sourceSchema = z.enum(["MANUAL", "IMPORTED", "AI_SUGGESTED"]);
const automationSchema = z.enum(["MANUAL", "CANDIDATE", "DRAFT", "AUTOMATED"]);

type TestCaseDependencies = WorkspaceContextDependencies;

export class TestCaseDomainError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409;

  constructor(code: string, status: 400 | 404 | 409) {
    super(code);
    this.name = "TestCaseDomainError";
    this.code = code;
    this.status = status;
  }
}

function client(dependencies?: TestCaseDependencies) {
  return dependencies?.prisma ?? getPrismaClient();
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new TestCaseDomainError("invalid_test_case_input", 400);
  }
  return result.data;
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim().toLowerCase()))].sort();
}

function jsonList(value: string[]): Prisma.InputJsonValue {
  return value;
}

export function readTestCaseList(value: Prisma.JsonValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

async function requireProjectContext(
  input: { orgSlug?: string; projectId: string },
  permission: WorkspacePermission,
  dependencies?: TestCaseDependencies,
) {
  const projectId = parseOrThrow(uuidSchema, input.projectId);
  const context = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission },
    dependencies,
  );
  return { context, projectId };
}

async function findTestCaseOrThrow(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    projectId: string;
    testCaseId: string;
    allowArchived?: boolean;
  },
) {
  const testCase = await transaction.testCase.findUnique({
    where: {
      organizationId_projectId_id: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        id: input.testCaseId,
      },
    },
  });
  if (!testCase || (testCase.status === "ARCHIVED" && !input.allowArchived)) {
    throw new TestCaseDomainError("test_case_not_found", 404);
  }
  return testCase;
}

export async function listTestCases(
  input: {
    projectId: string;
    orgSlug?: string;
    includeArchived?: boolean;
  } & ListParams,
  dependencies?: TestCaseDependencies,
) {
  const { context, projectId } = await requireProjectContext(
    input,
    "testcase:read",
    dependencies,
  );
  const params = parseListParams(input);
  const where = {
    organizationId: context.organization.id,
    projectId,
    ...(input.includeArchived ? {} : { status: { not: "ARCHIVED" as const } }),
    ...(params.contains ? { title: params.contains } : {}),
  };

  const [items, total] = await Promise.all([
    client(dependencies).testCase.findMany({
      where,
      include: {
        owner: { select: { id: true, displayName: true } },
        _count: { select: { requirementLinks: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: params.skip,
      take: params.take,
    }),
    client(dependencies).testCase.count({ where }),
  ]);

  return buildListResult(items, total, params);
}

export async function getTestCaseDetail(
  input: {
    projectId: string;
    testCaseId: string;
    orgSlug?: string;
    allowArchived?: boolean;
  },
  dependencies?: TestCaseDependencies,
) {
  const testCaseId = parseOrThrow(uuidSchema, input.testCaseId);
  const { context, projectId } = await requireProjectContext(
    input,
    "testcase:read",
    dependencies,
  );
  const testCase = await client(dependencies).testCase.findUnique({
    where: {
      organizationId_projectId_id: {
        organizationId: context.organization.id,
        projectId,
        id: testCaseId,
      },
    },
    include: {
      owner: { select: { id: true, displayName: true } },
      createdBy: { select: { id: true, displayName: true } },
      versions: {
        include: { createdBy: { select: { id: true, displayName: true } } },
        orderBy: { versionNumber: "desc" },
      },
      requirementLinks: {
        include: {
          requirement: {
            select: { id: true, title: true, status: true, currentVersionNumber: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!testCase || (testCase.status === "ARCHIVED" && !input.allowArchived)) {
    throw new TestCaseDomainError("test_case_not_found", 404);
  }
  return {
    testCase,
    canUpdate: context.can("testcase:update"),
    canSubmit: context.can("testcase:submit"),
    canApprove: context.can("testcase:approve"),
    canArchive: context.can("testcase:archive"),
    canManageTraceability: context.can("testcase:traceability"),
    canCreateRun: context.can("testrun:create"),
    canGenerateAutomation: context.can("automation:generate"),
  };
}

type TestCaseContent = {
  title: string;
  objective: string;
  preconditions: string;
  steps: string[];
  expectedResults: string[];
  priority: TestCasePriority;
  type: TestCaseType;
  source: TestCaseSource;
  tags: string[];
  automationStatus: AutomationStatus;
};

function versionData(
  input: TestCaseContent & {
    organizationId: string;
    projectId: string;
    testCaseId: string;
    versionNumber: number;
    ownerUserId: string;
    createdByUserId: string;
  },
) {
  return {
    ...input,
    steps: jsonList(input.steps),
    expectedResults: jsonList(input.expectedResults),
  };
}

export async function createTestCase(
  input: {
    projectId: string;
    orgSlug?: string;
    title: string;
    objective?: string;
    preconditions?: string;
    steps?: string[];
    expectedResults?: string[];
    priority?: TestCasePriority;
    type?: TestCaseType;
    source?: TestCaseSource;
    tags?: string[];
    automationStatus?: AutomationStatus;
    requirementIds?: string[];
    requestId?: string;
  },
  dependencies?: TestCaseDependencies,
) {
  const data = parseOrThrow(
    z.object({
      title: titleSchema,
      objective: textSchema.optional(),
      preconditions: textSchema.optional(),
      steps: listSchema.optional(),
      expectedResults: listSchema.optional(),
      priority: prioritySchema.optional(),
      type: typeSchema.optional(),
      source: sourceSchema.optional(),
      tags: tagsSchema.optional(),
      automationStatus: automationSchema.optional(),
      requirementIds: z.array(uuidSchema).max(100).optional(),
    }),
    input,
  );
  const { context, projectId } = await requireProjectContext(
    input,
    "testcase:create",
    dependencies,
  );
  const content: TestCaseContent = {
    title: data.title,
    objective: data.objective ?? "",
    preconditions: data.preconditions ?? "",
    steps: data.steps ?? [],
    expectedResults: data.expectedResults ?? [],
    priority: data.priority ?? "MEDIUM",
    type: data.type ?? "FUNCTIONAL",
    source: data.source ?? "MANUAL",
    tags: normalizeTags(data.tags ?? []),
    automationStatus: data.automationStatus ?? "MANUAL",
  };
  const requirementIds = [...new Set(data.requirementIds ?? [])];

  return client(dependencies).$transaction(async (transaction) => {
    if (requirementIds.length) {
      const requirementCount = await transaction.requirement.count({
        where: {
          organizationId: context.organization.id,
          projectId,
          id: { in: requirementIds },
          status: { not: "ARCHIVED" },
        },
      });
      if (requirementCount !== requirementIds.length) {
        throw new TestCaseDomainError("requirement_not_found", 404);
      }
    }
    const testCase = await transaction.testCase.create({
      data: {
        organizationId: context.organization.id,
        projectId,
        ...content,
        steps: jsonList(content.steps),
        expectedResults: jsonList(content.expectedResults),
        ownerUserId: context.user.id,
        createdByUserId: context.user.id,
      },
    });
    await transaction.testCaseVersion.create({
      data: versionData({
        organizationId: context.organization.id,
        projectId,
        testCaseId: testCase.id,
        versionNumber: 1,
        ...content,
        ownerUserId: context.user.id,
        createdByUserId: context.user.id,
      }),
    });
    if (requirementIds.length) {
      await transaction.requirementTestCase.createMany({
        data: requirementIds.map((requirementId) => ({
          organizationId: context.organization.id,
          projectId,
          requirementId,
          testCaseId: testCase.id,
          createdByUserId: context.user.id,
        })),
      });
    }
    await transaction.activity.create({
      data: {
        organizationId: context.organization.id,
        projectId,
        actorUserId: context.user.id,
        source: "USER",
        action: "TEST_CASE_CREATED",
        targetType: "TEST_CASE",
        targetId: testCase.id,
        requestId: input.requestId ?? null,
        metadata: { versionNumber: 1, linkedRequirementCount: requirementIds.length },
      },
    });
    return testCase;
  });
}

export async function updateTestCaseDraft(
  input: {
    projectId: string;
    testCaseId: string;
    expectedVersion: number;
    orgSlug?: string;
    title?: string;
    objective?: string;
    preconditions?: string;
    steps?: string[];
    expectedResults?: string[];
    priority?: TestCasePriority;
    type?: TestCaseType;
    source?: TestCaseSource;
    tags?: string[];
    automationStatus?: AutomationStatus;
    requestId?: string;
  },
  dependencies?: TestCaseDependencies,
) {
  const testCaseId = parseOrThrow(uuidSchema, input.testCaseId);
  const expectedVersion = parseOrThrow(versionSchema, input.expectedVersion);
  const patch = parseOrThrow(
    z.object({
      title: titleSchema.optional(), objective: textSchema.optional(),
      preconditions: textSchema.optional(), steps: listSchema.optional(),
      expectedResults: listSchema.optional(), priority: prioritySchema.optional(),
      type: typeSchema.optional(), source: sourceSchema.optional(),
      tags: tagsSchema.optional(), automationStatus: automationSchema.optional(),
    }).refine((value) => Object.values(value).some((item) => item !== undefined)),
    input,
  );
  const { context, projectId } = await requireProjectContext(
    input,
    "testcase:update",
    dependencies,
  );
  return client(dependencies).$transaction(async (transaction) => {
    const existing = await findTestCaseOrThrow(transaction, {
      organizationId: context.organization.id, projectId, testCaseId,
    });
    if (existing.status !== "DRAFT") {
      throw new TestCaseDomainError("test_case_not_editable", 409);
    }
    if (existing.currentVersionNumber !== expectedVersion) {
      throw new TestCaseDomainError("test_case_version_conflict", 409);
    }
    const next: TestCaseContent = {
      title: patch.title ?? existing.title,
      objective: patch.objective ?? existing.objective,
      preconditions: patch.preconditions ?? existing.preconditions,
      steps: patch.steps ?? readTestCaseList(existing.steps),
      expectedResults: patch.expectedResults ?? readTestCaseList(existing.expectedResults),
      priority: patch.priority ?? existing.priority,
      type: patch.type ?? existing.type,
      source: patch.source ?? existing.source,
      tags: patch.tags ? normalizeTags(patch.tags) : existing.tags,
      automationStatus: patch.automationStatus ?? existing.automationStatus,
    };
    const before = {
      title: existing.title, objective: existing.objective,
      preconditions: existing.preconditions, steps: readTestCaseList(existing.steps),
      expectedResults: readTestCaseList(existing.expectedResults), priority: existing.priority,
      type: existing.type, source: existing.source, tags: existing.tags,
      automationStatus: existing.automationStatus,
    };
    const changedFields = (Object.keys(next) as Array<keyof TestCaseContent>).filter(
      (field) => JSON.stringify(next[field]) !== JSON.stringify(before[field]),
    );
    if (!changedFields.length) return existing;
    const versionNumber = expectedVersion + 1;
    const update = await transaction.testCase.updateMany({
      where: {
        organizationId: context.organization.id, projectId, id: testCaseId,
        status: "DRAFT", currentVersionNumber: expectedVersion,
      },
      data: {
        ...next, steps: jsonList(next.steps), expectedResults: jsonList(next.expectedResults),
        currentVersionNumber: versionNumber,
      },
    });
    if (update.count !== 1) {
      throw new TestCaseDomainError("test_case_version_conflict", 409);
    }
    await transaction.testCaseVersion.create({
      data: versionData({
        organizationId: context.organization.id, projectId, testCaseId,
        versionNumber, ...next, ownerUserId: existing.ownerUserId,
        createdByUserId: context.user.id,
      }),
    });
    await transaction.activity.create({
      data: {
        organizationId: context.organization.id, projectId,
        actorUserId: context.user.id, source: "USER", action: "TEST_CASE_UPDATED",
        targetType: "TEST_CASE", targetId: testCaseId,
        requestId: input.requestId ?? null,
        metadata: { versionNumber, changedFields: changedFields.sort() },
      },
    });
    return transaction.testCase.findUniqueOrThrow({
      where: { organizationId_projectId_id: {
        organizationId: context.organization.id, projectId, id: testCaseId,
      } },
    });
  });
}

async function transitionTestCase(
  input: { projectId: string; testCaseId: string; orgSlug?: string; requestId?: string },
  transition: {
    permission: WorkspacePermission;
    from: readonly TestCaseStatus[];
    to: TestCaseStatus;
    action: "TEST_CASE_SUBMITTED_FOR_REVIEW" | "TEST_CASE_CHANGES_REQUESTED" | "TEST_CASE_APPROVED" | "TEST_CASE_ARCHIVED";
  },
  dependencies?: TestCaseDependencies,
) {
  const testCaseId = parseOrThrow(uuidSchema, input.testCaseId);
  const { context, projectId } = await requireProjectContext(input, transition.permission, dependencies);
  return client(dependencies).$transaction(async (transaction) => {
    const existing = await findTestCaseOrThrow(transaction, {
      organizationId: context.organization.id, projectId, testCaseId,
    });
    if (!transition.from.includes(existing.status)) {
      throw new TestCaseDomainError("invalid_test_case_transition", 409);
    }
    if (transition.to === "IN_REVIEW" && (
      !existing.objective.trim() || !readTestCaseList(existing.steps).length ||
      !readTestCaseList(existing.expectedResults).length
    )) {
      throw new TestCaseDomainError("test_case_review_incomplete", 409);
    }
    const now = new Date();
    const update = await transaction.testCase.updateMany({
      where: {
        organizationId: context.organization.id, projectId, id: testCaseId,
        status: { in: [...transition.from] }, currentVersionNumber: existing.currentVersionNumber,
      },
      data: {
        status: transition.to,
        ...(transition.to === "IN_REVIEW" ? { submittedForReviewAt: now, approvedAt: null } : {}),
        ...(transition.to === "DRAFT" ? { submittedForReviewAt: null, approvedAt: null } : {}),
        ...(transition.to === "APPROVED" ? { approvedAt: now } : {}),
        ...(transition.to === "ARCHIVED" ? { archivedAt: now } : {}),
      },
    });
    if (update.count !== 1) {
      throw new TestCaseDomainError("invalid_test_case_transition", 409);
    }
    await transaction.activity.create({ data: {
      organizationId: context.organization.id, projectId,
      actorUserId: context.user.id, source: "USER", action: transition.action,
      targetType: "TEST_CASE", targetId: testCaseId, requestId: input.requestId ?? null,
      metadata: { fromStatus: existing.status, toStatus: transition.to,
        versionNumber: existing.currentVersionNumber },
    } });
    return transaction.testCase.findUniqueOrThrow({ where: {
      organizationId_projectId_id: { organizationId: context.organization.id, projectId, id: testCaseId },
    } });
  });
}

type TransitionInput = { projectId: string; testCaseId: string; orgSlug?: string; requestId?: string };

export function submitTestCaseForReview(input: TransitionInput, dependencies?: TestCaseDependencies) {
  return transitionTestCase(input, { permission: "testcase:submit", from: ["DRAFT"], to: "IN_REVIEW", action: "TEST_CASE_SUBMITTED_FOR_REVIEW" }, dependencies);
}
/**
 * Sends a Test Case back to draft, from review or from approval.
 *
 * Reopening an approved Test Case is what lets intent change as the product
 * does. Without it an approved Test Case was frozen for good, and a team whose
 * behaviour changed had to abandon it and start a new one, losing the
 * traceability chain this product exists to keep. Three features were already
 * written for intent that moves on -- the superseded-automation gap, the
 * release caution for automation pinned to an old version, and the
 * INTENT_CHANGED run signal -- and none of them could ever fire, which is what
 * showed the transition was missing rather than withheld.
 *
 * Nothing already recorded is disturbed. Versions stay immutable, and automation
 * and runs stay pinned to the version they were made for. Only new automation
 * and new runs are refused while the Test Case sits in draft, because both
 * require approved intent, and coverage correctly reads as lost until it is
 * approved again.
 */
export function requestTestCaseChanges(input: TransitionInput, dependencies?: TestCaseDependencies) {
  return transitionTestCase(input, { permission: "testcase:approve", from: ["IN_REVIEW", "APPROVED"], to: "DRAFT", action: "TEST_CASE_CHANGES_REQUESTED" }, dependencies);
}
export function approveTestCase(input: TransitionInput, dependencies?: TestCaseDependencies) {
  return transitionTestCase(input, { permission: "testcase:approve", from: ["IN_REVIEW"], to: "APPROVED", action: "TEST_CASE_APPROVED" }, dependencies);
}
export function archiveTestCase(input: TransitionInput, dependencies?: TestCaseDependencies) {
  return transitionTestCase(input, { permission: "testcase:archive", from: ["DRAFT", "IN_REVIEW", "APPROVED"], to: "ARCHIVED", action: "TEST_CASE_ARCHIVED" }, dependencies);
}

export async function linkRequirementToTestCase(
  input: TransitionInput & { requirementId: string }, dependencies?: TestCaseDependencies,
) {
  const testCaseId = parseOrThrow(uuidSchema, input.testCaseId);
  const requirementId = parseOrThrow(uuidSchema, input.requirementId);
  const { context, projectId } = await requireProjectContext(input, "testcase:traceability", dependencies);
  return client(dependencies).$transaction(async (transaction) => {
    await findTestCaseOrThrow(transaction, { organizationId: context.organization.id, projectId, testCaseId });
    const requirement = await transaction.requirement.findUnique({ where: {
      organizationId_projectId_id: { organizationId: context.organization.id, projectId, id: requirementId },
    } });
    if (!requirement || requirement.status === "ARCHIVED") {
      throw new TestCaseDomainError("requirement_not_found", 404);
    }
    const key = { organizationId: context.organization.id, projectId, requirementId, testCaseId };
    const existing = await transaction.requirementTestCase.findUnique({ where: {
      organizationId_projectId_requirementId_testCaseId: key,
    } });
    if (existing) return existing;
    const link = await transaction.requirementTestCase.create({ data: {
      ...key, createdByUserId: context.user.id,
    } });
    await transaction.activity.create({ data: {
      organizationId: context.organization.id, projectId, actorUserId: context.user.id,
      source: "USER", action: "TEST_CASE_REQUIREMENT_LINKED",
      targetType: "REQUIREMENT_TEST_CASE", targetId: testCaseId,
      requestId: input.requestId ?? null, metadata: { requirementId, testCaseId },
    } });
    return link;
  });
}

export async function unlinkRequirementFromTestCase(
  input: TransitionInput & { requirementId: string }, dependencies?: TestCaseDependencies,
) {
  const testCaseId = parseOrThrow(uuidSchema, input.testCaseId);
  const requirementId = parseOrThrow(uuidSchema, input.requirementId);
  const { context, projectId } = await requireProjectContext(input, "testcase:traceability", dependencies);
  return client(dependencies).$transaction(async (transaction) => {
    await findTestCaseOrThrow(transaction, { organizationId: context.organization.id, projectId, testCaseId, allowArchived: true });
    const removed = await transaction.requirementTestCase.deleteMany({ where: {
      organizationId: context.organization.id, projectId, requirementId, testCaseId,
    } });
    if (!removed.count) return false;
    await transaction.activity.create({ data: {
      organizationId: context.organization.id, projectId, actorUserId: context.user.id,
      source: "USER", action: "TEST_CASE_REQUIREMENT_UNLINKED",
      targetType: "REQUIREMENT_TEST_CASE", targetId: testCaseId,
      requestId: input.requestId ?? null, metadata: { requirementId, testCaseId },
    } });
    return true;
  });
}

export function testCaseDomainErrorResponse(error: unknown): Response | null {
  if (!(error instanceof TestCaseDomainError)) return null;
  return Response.json({ status: "error", code: error.code }, { status: error.status });
}
