import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import {
  generateAutomation,
  validateAutomationGeneration,
  type AutomationGenerationInput,
  type AutomationGenerationResult,
  type AutomationValidationFinding,
} from "@/lib/ai/automation-generation";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
  type WorkspacePermission,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { applyTestCaseVersionMarker } from "@/lib/integrations/runner/ingest-token";
import {
  OrganizationAiRateLimitError,
  reserveOrganizationAiRequest,
} from "@/lib/operations/organization-ai-guard";
import {
  buildListResult,
  parseListParams,
  type ListParams,
} from "@/lib/services/list-query";
import { readTestCaseList } from "@/lib/services/test-cases";
import { checkSelfApproval, describeReviewTrail } from "@/lib/services/approval-policy";
import { readRunEvidence } from "@/lib/services/imported-drafts";
import { planPreviewRun } from "@/lib/free-tools/preview-run/plan";

const uuidSchema = z.string().uuid();
const engineSchema = z.enum(["PLAYWRIGHT_BROWSER", "PLAYWRIGHT_API"]);
const guidanceSchema = z.string().trim().max(10_000);
const PROMPT_VERSION = "automation-generation-v1";
const SCHEMA_VERSION = "automation-artifact-schema-v1";

type Dependencies = WorkspaceContextDependencies & {
  generator?: (
    input: AutomationGenerationInput,
  ) => Promise<AutomationGenerationResult>;
};

export class AutomationArtifactDomainError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409 | 429 | 502 | 503;

  constructor(code: string, status: 400 | 404 | 409 | 429 | 502 | 503) {
    super(code);
    this.name = "AutomationArtifactDomainError";
    this.code = code;
    this.status = status;
  }
}

function client(dependencies?: Dependencies) {
  return dependencies?.prisma ?? getPrismaClient();
}

function parseUuid(value: string): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) {
    throw new AutomationArtifactDomainError("invalid_automation_input", 400);
  }
  return result.data;
}

function parseEngine(value: string) {
  const result = engineSchema.safeParse(value);
  if (!result.success) {
    throw new AutomationArtifactDomainError("invalid_automation_input", 400);
  }
  return result.data;
}

async function context(
  input: { orgSlug?: string; projectId: string },
  permission: WorkspacePermission,
  dependencies?: Dependencies,
) {
  const projectId = parseUuid(input.projectId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission },
    dependencies,
  );
  return { workspace, projectId };
}

export function readAutomationPlan(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (
      typeof record.title !== "string" ||
      typeof record.intent !== "string" ||
      typeof record.expectedAssertion !== "string"
    ) {
      return [];
    }
    return [{
      title: record.title,
      intent: record.intent,
      expectedAssertion: record.expectedAssertion,
    }];
  });
}

export function readAutomationValidationFindings(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AutomationValidationFinding[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    if (
      (record.severity !== "BLOCKING" && record.severity !== "WARNING") ||
      typeof record.code !== "string" ||
      typeof record.message !== "string"
    ) {
      return [];
    }
    return [{
      severity: record.severity,
      code: record.code,
      message: record.message,
    }];
  });
}

export async function listAutomationArtifacts(
  input: {
    orgSlug?: string;
    projectId: string;
    testCaseId?: string;
    includeArchived?: boolean;
  } & ListParams,
  dependencies?: Dependencies,
) {
  const { workspace, projectId } = await context(
    input,
    "automation:read",
    dependencies,
  );
  const testCaseId = input.testCaseId ? parseUuid(input.testCaseId) : undefined;
  const params = parseListParams(input);
  // Artifact name and the Test Case it automates, since an artifact is usually
  // remembered by the behaviour it covers.
  const where = {
    organizationId: workspace.organization.id,
    projectId,
    ...(testCaseId ? { testCaseId } : {}),
    ...(input.includeArchived ? {} : { status: { not: "ARCHIVED" as const } }),
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
    client(dependencies).automationArtifact.findMany({
      where,
      include: {
        testCase: { select: { id: true, title: true, status: true } },
        testCaseVersion: { select: { versionNumber: true } },
        createdBy: { select: { displayName: true } },
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: params.skip,
      take: params.take,
    }),
    client(dependencies).automationArtifact.count({ where }),
  ]);

  return buildListResult(items, total, params);
}

export async function getAutomationArtifactDetail(
  input: {
    orgSlug?: string;
    projectId: string;
    automationArtifactId: string;
    allowArchived?: boolean;
  },
  dependencies?: Dependencies,
) {
  const automationArtifactId = parseUuid(input.automationArtifactId);
  const { workspace, projectId } = await context(
    input,
    "automation:read",
    dependencies,
  );
  const artifact = await client(dependencies).automationArtifact.findUnique({
    where: {
      organizationId_projectId_id: {
        organizationId: workspace.organization.id,
        projectId,
        id: automationArtifactId,
      },
    },
    include: {
      // The Test Case's current version is loaded so the artifact page can say
      // whether the version it is pinned to is still the current one. Without
      // it the page can only state that a pin exists, which reads as reassuring
      // on automation whose intent has since moved on.
      testCase: {
        select: { id: true, title: true, status: true, currentVersionNumber: true },
      },
      testCaseVersion: true,
      createdBy: { select: { displayName: true } },
      approvedBy: { select: { displayName: true } },
      versions: {
        include: { createdBy: { select: { displayName: true } } },
        orderBy: { versionNumber: "desc" },
      },
    },
  });
  if (!artifact || (artifact.status === "ARCHIVED" && !input.allowArchived)) {
    throw new AutomationArtifactDomainError("automation_artifact_not_found", 404);
  }
  const reviewTrail = await describeReviewTrail(client(dependencies), {
    organizationId: workspace.organization.id,
    projectId,
    targetType: "AUTOMATION_ARTIFACT",
    targetId: artifact.id,
    actions: {
      submitted: "AUTOMATION_SUBMITTED_FOR_REVIEW",
      approved: "AUTOMATION_APPROVED",
      changesRequested: "AUTOMATION_CHANGES_REQUESTED",
    },
    viewerUserId: workspace.user.id,
    inReview: artifact.status === "IN_REVIEW",
  });
  return {
    artifact,
    reviewTrail,
    canGenerate: workspace.can("automation:generate"),
    canSubmit: workspace.can("automation:submit"),
    canApprove: workspace.can("automation:approve"),
  };
}

async function findOrCreateArtifact(input: {
  organizationId: string;
  projectId: string;
  testCaseId: string;
  testCaseVersionId: string;
  engine: "PLAYWRIGHT_BROWSER" | "PLAYWRIGHT_API";
  name: string;
  userId: string;
  requestId?: string;
}, dependencies?: Dependencies) {
  const existing = await client(dependencies).automationArtifact.findUnique({
    where: {
      organizationId_projectId_testCaseVersionId_engine: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        testCaseVersionId: input.testCaseVersionId,
        engine: input.engine,
      },
    },
  });
  if (existing) return existing;

  return client(dependencies).$transaction(async (transaction) => {
    const artifact = await transaction.automationArtifact.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        testCaseId: input.testCaseId,
        testCaseVersionId: input.testCaseVersionId,
        engine: input.engine,
        name: input.name,
        createdByUserId: input.userId,
      },
    });
    await transaction.activity.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorUserId: input.userId,
        source: "USER",
        action: "AUTOMATION_ARTIFACT_CREATED",
        targetType: "AUTOMATION_ARTIFACT",
        targetId: artifact.id,
        requestId: input.requestId ?? null,
        metadata: {
          testCaseId: input.testCaseId,
          testCaseVersionId: input.testCaseVersionId,
          engine: input.engine,
        },
      },
    });
    return artifact;
  });
}

/** A generation still running after this long is treated as abandoned. */
const GENERATION_STALE_MS = 10 * 60_000;

type PendingGeneration = {
  organizationId: string;
  projectId: string;
  userId: string;
  artifactId: string;
  versionId: string;
  versionNumber: number;
  testCaseId: string;
  testCaseVersionId: string;
  testCaseAutomationStatus: string;
  engine: "PLAYWRIGHT_BROWSER" | "PLAYWRIGHT_API";
  generationInput: AutomationGenerationInput;
  configuredModel: string;
  promptVersion: string;
  requestId?: string;
};

type GenerationInput = {
  orgSlug?: string;
  projectId: string;
  testCaseId: string;
  engine: "PLAYWRIGHT_BROWSER" | "PLAYWRIGHT_API";
  guidance?: string;
  requestId?: string;
};

/**
 * Everything up to the model call: checks, the AI allowance, and a version
 * row marked RUNNING, committed before the slow part starts.
 *
 * Generating used to happen inside the request that pressed the button, which
 * took 30 to 90 seconds. That was long enough for the sign-in session token to
 * lapse mid-request, so the page that should have shown the result sometimes
 * showed an empty sign-in screen instead -- and the person could not leave the
 * page without abandoning the wait. Recording the version first lets the page
 * open at once and fill in when the code is ready.
 */
async function beginAutomationGeneration(
  input: GenerationInput,
  dependencies?: Dependencies,
  /** Code that already exists (an imported draft): no model call, no AI allowance. */
  seeded?: { model: string; promptVersion: string },
): Promise<PendingGeneration> {
  const testCaseId = parseUuid(input.testCaseId);
  const engine = parseEngine(input.engine);
  const guidanceResult = guidanceSchema.safeParse(input.guidance ?? "");
  if (!guidanceResult.success) {
    throw new AutomationArtifactDomainError("invalid_automation_input", 400);
  }
  const { workspace, projectId } = await context(
    input,
    "automation:generate",
    dependencies,
  );
  const testCase = await client(dependencies).testCase.findUnique({
    where: {
      organizationId_projectId_id: {
        organizationId: workspace.organization.id,
        projectId,
        id: testCaseId,
      },
    },
  });
  if (!testCase) {
    throw new AutomationArtifactDomainError("test_case_not_found", 404);
  }
  if (testCase.status !== "APPROVED") {
    throw new AutomationArtifactDomainError("approved_test_case_required", 409);
  }
  const testCaseVersion = await client(dependencies).testCaseVersion.findUnique({
    where: {
      organizationId_projectId_testCaseId_versionNumber: {
        organizationId: workspace.organization.id,
        projectId,
        testCaseId,
        versionNumber: testCase.currentVersionNumber,
      },
    },
  });
  if (!testCaseVersion) {
    throw new AutomationArtifactDomainError("test_case_version_not_found", 404);
  }

  const engineLabel = engine === "PLAYWRIGHT_BROWSER" ? "Browser" : "API";
  const artifact = await findOrCreateArtifact({
    organizationId: workspace.organization.id,
    projectId,
    testCaseId,
    testCaseVersionId: testCaseVersion.id,
    engine,
    name: `${testCaseVersion.title} — ${engineLabel}`,
    userId: workspace.user.id,
    requestId: input.requestId,
  }, dependencies);
  if (artifact.status === "IN_REVIEW" || artifact.status === "ARCHIVED") {
    throw new AutomationArtifactDomainError("automation_generation_not_allowed", 409);
  }

  // One generation at a time per artifact; a second press while the first is
  // still writing would only race it. An abandoned run stops blocking after a
  // while, so a crash can never lock the artifact.
  const running = await client(dependencies).automationArtifactVersion.findFirst({
    where: {
      automationArtifactId: artifact.id,
      generationStatus: "RUNNING",
      startedAt: { gt: new Date(Date.now() - GENERATION_STALE_MS) },
    },
    select: { id: true },
  });
  if (running) {
    throw new AutomationArtifactDomainError("automation_generation_in_progress", 409);
  }

  if (!dependencies?.generator && !seeded) {
    try {
      await reserveOrganizationAiRequest({
        organizationId: workspace.organization.id,
        surface: "automation-generation",
      });
    } catch (error) {
      if (error instanceof OrganizationAiRateLimitError) {
        throw new AutomationArtifactDomainError(error.code, 429);
      }
      throw new AutomationArtifactDomainError("ai_guard_unavailable", 503);
    }
  }

  const expectedVersionNumber = artifact.currentVersionNumber;
  const versionNumber = expectedVersionNumber + 1;
  const configuredModel =
    seeded?.model ?? (process.env.OPENAI_AUTOMATION_MODEL?.trim() || "gpt-5-mini");
  const promptVersion = seeded?.promptVersion ?? PROMPT_VERSION;
  const generationInput: AutomationGenerationInput = {
    engine,
    title: testCaseVersion.title,
    objective: testCaseVersion.objective,
    preconditions: testCaseVersion.preconditions,
    steps: readTestCaseList(testCaseVersion.steps),
    expectedResults: readTestCaseList(testCaseVersion.expectedResults),
    testType: testCaseVersion.type,
    priority: testCaseVersion.priority,
    tags: testCaseVersion.tags,
    guidance: guidanceResult.data,
  };

  const version = await client(dependencies).$transaction(async (transaction) => {
    const update = await transaction.automationArtifact.updateMany({
      where: {
        id: artifact.id,
        organizationId: workspace.organization.id,
        projectId,
        currentVersionNumber: expectedVersionNumber,
        status: { in: ["DRAFT", "APPROVED"] },
      },
      data: {
        currentVersionNumber: versionNumber,
        status: "DRAFT",
        submittedForReviewAt: null,
      },
    });
    if (update.count !== 1) {
      throw new AutomationArtifactDomainError("automation_version_conflict", 409);
    }
    return transaction.automationArtifactVersion.create({
      data: {
        organizationId: workspace.organization.id,
        projectId,
        automationArtifactId: artifact.id,
        versionNumber,
        generationStatus: "RUNNING",
        validationStatus: "BLOCKED",
        summary: "Writing the Playwright test…",
        plan: [] as Prisma.InputJsonValue,
        code: "",
        configuration: "",
        dependencies: [],
        assumptions: [],
        validationFindings: [] as Prisma.InputJsonValue,
        model: configuredModel,
        promptVersion,
        schemaVersion: SCHEMA_VERSION,
        createdByUserId: workspace.user.id,
      },
    });
  });

  return {
    organizationId: workspace.organization.id,
    projectId,
    userId: workspace.user.id,
    artifactId: artifact.id,
    versionId: version.id,
    versionNumber,
    testCaseId,
    testCaseVersionId: testCaseVersion.id,
    testCaseAutomationStatus: testCase.automationStatus,
    engine,
    generationInput,
    configuredModel,
    promptVersion,
    requestId: input.requestId,
  };
}

/**
 * The model call and its outcome, written onto the RUNNING version.
 *
 * A model failure does not throw: the version ends FAILED with a code, just as
 * it did when generation ran inline.
 */
async function finishAutomationGeneration(
  pending: PendingGeneration,
  dependencies?: Dependencies,
  /** Supplies existing code instead of calling the model. */
  seededResult?: AutomationGenerationResult,
) {
  let result: AutomationGenerationResult | null = null;
  let failureCode: string | null = null;
  try {
    result = seededResult ?? (await (dependencies?.generator ?? generateAutomation)(pending.generationInput));
  } catch (error) {
    failureCode =
      error instanceof Error && /^[a-z_]+$/.test(error.message)
        ? error.message
        : "provider_failure";
  }

  // Stamp the pinned version into the generated code before validation so the
  // reviewed code and the stored code are byte-identical. Without this marker a
  // CI result cannot be mapped back to the immutable version it exercised.
  if (result) {
    result = {
      ...result,
      code: applyTestCaseVersionMarker(result.code, pending.testCaseVersionId),
    };
  }
  const validation = result
    ? validateAutomationGeneration(pending.engine, result)
    : { status: "BLOCKED" as const, findings: [] };

  return client(dependencies).$transaction(async (transaction) => {
    await transaction.automationArtifactVersion.update({
      where: { id: pending.versionId },
      data: {
        generationStatus: result ? "SUCCEEDED" : "FAILED",
        validationStatus: validation.status,
        summary: result?.summary ?? "Automation generation failed safely.",
        plan: (result?.plan ?? []) as Prisma.InputJsonValue,
        code: result?.code ?? "",
        configuration: result?.configuration ?? "",
        dependencies: result?.dependencies ?? [],
        assumptions: result?.assumptions ?? [],
        validationFindings: validation.findings as Prisma.InputJsonValue,
        model: result?.model ?? pending.configuredModel,
        inputTokens: result?.inputTokens ?? null,
        outputTokens: result?.outputTokens ?? null,
        totalTokens: result?.totalTokens ?? null,
        failureCode,
        completedAt: new Date(),
      },
    });
    if (result?.name) {
      await transaction.automationArtifact.updateMany({
        where: {
          id: pending.artifactId,
          organizationId: pending.organizationId,
          projectId: pending.projectId,
          currentVersionNumber: pending.versionNumber,
        },
        data: { name: result.name },
      });
    }
    if (pending.testCaseAutomationStatus !== "AUTOMATED") {
      const automationSummaryUpdate = await transaction.testCase.updateMany({
        where: {
          id: pending.testCaseId,
          organizationId: pending.organizationId,
          projectId: pending.projectId,
        },
        data: { automationStatus: "DRAFT" },
      });
      if (automationSummaryUpdate.count !== 1) {
        throw new AutomationArtifactDomainError("test_case_not_found", 404);
      }
    }
    await transaction.activity.create({
      data: {
        organizationId: pending.organizationId,
        projectId: pending.projectId,
        actorUserId: pending.userId,
        source: "USER",
        action: "AUTOMATION_VERSION_GENERATED",
        targetType: "AUTOMATION_ARTIFACT_VERSION",
        targetId: pending.versionId,
        requestId: pending.requestId ?? null,
        metadata: {
          automationArtifactId: pending.artifactId,
          testCaseId: pending.testCaseId,
          testCaseVersionId: pending.testCaseVersionId,
          engine: pending.engine,
          versionNumber: pending.versionNumber,
          generationStatus: result ? "SUCCEEDED" : "FAILED",
          validationStatus: validation.status,
          promptVersion: pending.promptVersion,
          schemaVersion: SCHEMA_VERSION,
        },
      },
    });
    return transaction.automationArtifact.findUniqueOrThrow({
      where: { id: pending.artifactId },
      include: { versions: { orderBy: { versionNumber: "desc" } } },
    });
  });
}

/** Marks a version FAILED when finishing could not record its outcome. */
async function abandonAutomationGeneration(
  pending: PendingGeneration,
  dependencies?: Dependencies,
) {
  await client(dependencies).automationArtifactVersion.updateMany({
    where: { id: pending.versionId, generationStatus: "RUNNING" },
    data: {
      generationStatus: "FAILED",
      failureCode: "generation_interrupted",
      summary: "Automation generation did not finish.",
      completedAt: new Date(),
    },
  });
}

/** Generates and waits for the result. */
export async function generateAutomationArtifact(
  input: GenerationInput,
  dependencies?: Dependencies,
) {
  const pending = await beginAutomationGeneration(input, dependencies);
  try {
    return await finishAutomationGeneration(pending, dependencies);
  } catch (error) {
    await abandonAutomationGeneration(pending, dependencies).catch(() => {});
    throw error;
  }
}

/**
 * Starts generating and returns at once, handing the model call to `schedule`
 * (the page passes Next's `after`). The artifact page shows the version as
 * running and refreshes itself until it completes.
 */
export async function startAutomationArtifactGeneration(
  input: GenerationInput,
  schedule: (task: () => Promise<void>) => void,
  dependencies?: Dependencies,
) {
  const pending = await beginAutomationGeneration(input, dependencies);
  schedule(async () => {
    try {
      await finishAutomationGeneration(pending, dependencies);
    } catch (error) {
      console.error("[automation] background generation failed", error);
      await abandonAutomationGeneration(pending, dependencies).catch(() => {});
    }
  });
  return { automationArtifactId: pending.artifactId, versionNumber: pending.versionNumber };
}

const IMPORT_PROMPT_VERSION = "free-tool-import-v1";

function importedPlan(code: string) {
  const plan = planPreviewRun(code).tests.slice(0, 50).map((test) => {
    const checks = test.steps.flatMap((step) => step.operations).filter((operation) => operation.op === "expect").length;
    const stepNames = test.steps.map((step) => step.name).filter(Boolean);
    return {
      title: test.name.slice(0, 300) || "Imported test",
      intent: (stepNames.length > 1 ? stepNames.join(" → ") : "Replays the imported Playwright steps.").slice(0, 2_000),
      expectedAssertion: checks ? `${checks} assertion${checks === 1 ? "" : "s"} in this test.` : "See the assertions in the code.",
    };
  });
  return plan.length
    ? plan
    : [{ title: "Imported test", intent: "Replays the imported Playwright steps.", expectedAssertion: "See the assertions in the code." }];
}

function importedConfiguration(pageUrl: string | null) {
  const baseUrl = pageUrl ? JSON.stringify(pageUrl) : "undefined";
  return [
    "import { defineConfig, devices } from '@playwright/test';",
    "",
    "export default defineConfig({",
    "  testDir: './tests',",
    "  retries: process.env.CI ? 1 : 0,",
    "  use: {",
    `    baseURL: process.env.BASE_URL ?? ${baseUrl},`,
    "    trace: 'on-first-retry',",
    "  },",
    "  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],",
    "});",
    "",
  ].join("\n");
}

/**
 * The first automation version from code imported with the Test Case.
 *
 * Nothing is generated: the code a person already proved on the live page
 * becomes a draft version and goes through the same checks and review as a
 * generated one. It uses no AI allowance, and each imported draft seeds one
 * version only.
 */
export async function createAutomationFromImportedDraft(
  input: { orgSlug?: string; projectId: string; testCaseId: string; requestId?: string },
  dependencies?: Dependencies,
) {
  const testCaseId = parseUuid(input.testCaseId);
  const { workspace, projectId } = await context(input, "automation:generate", dependencies);
  const draft = await client(dependencies).testCaseImportedDraft.findUnique({
    where: {
      organizationId_projectId_testCaseId: {
        organizationId: workspace.organization.id,
        projectId,
        testCaseId,
      },
    },
  });
  if (!draft) throw new AutomationArtifactDomainError("imported_draft_not_found", 404);
  if (draft.usedAt) throw new AutomationArtifactDomainError("imported_draft_already_used", 409);

  const evidence = readRunEvidence(draft.runEvidence);
  const engine = /\bpage\b/.test(draft.code) ? "PLAYWRIGHT_BROWSER" : "PLAYWRIGHT_API";
  const pending = await beginAutomationGeneration(
    { orgSlug: input.orgSlug, projectId, testCaseId, engine, requestId: input.requestId },
    dependencies,
    { model: "imported-draft", promptVersion: IMPORT_PROMPT_VERSION },
  );
  const proven =
    evidence?.verdict === "passed"
      ? `It passed on the live page before import: ${evidence.passed} checks at ${evidence.pageUrl}.`
      : evidence?.verdict === "partial"
        ? `Every step that could run passed on the live page before import (${evidence.passed} checks); ${evidence.skipped + evidence.notReached} did not run there.`
        : evidence?.verdict === "failed"
          ? "Its last run on the live page before import failed."
          : "It was not run on the live page before import.";
  const seeded: AutomationGenerationResult = {
    name: `${pending.generationInput.title} — ${engine === "PLAYWRIGHT_BROWSER" ? "Browser" : "API"}`,
    summary: `Imported from Quick Generate with this Test Case. ${proven}`,
    plan: importedPlan(draft.code),
    code: draft.code,
    configuration: importedConfiguration(draft.pageUrl),
    dependencies: ["@playwright/test"],
    assumptions: [
      proven,
      "Written before this Test Case was approved; check that it covers the approved steps and expected results.",
    ],
    model: "imported-draft",
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  };

  try {
    const artifact = await finishAutomationGeneration(pending, dependencies, seeded);
    await client(dependencies).testCaseImportedDraft.updateMany({
      where: { id: draft.id, usedAt: null },
      data: { usedAt: new Date(), usedInAutomationVersionId: pending.versionId },
    });
    return artifact;
  } catch (error) {
    await abandonAutomationGeneration(pending, dependencies).catch(() => {});
    throw error;
  }
}

/** True when a version has been running so long it will never finish. */
export function isGenerationStalled(version: { generationStatus: string; startedAt: Date }) {
  return (
    version.generationStatus === "RUNNING" &&
    Date.now() - version.startedAt.getTime() > GENERATION_STALE_MS
  );
}

async function transition(
  input: {
    orgSlug?: string;
    projectId: string;
    automationArtifactId: string;
    intent: "SUBMIT" | "REQUEST_CHANGES" | "APPROVE";
    requestId?: string;
  },
  dependencies?: Dependencies,
) {
  const automationArtifactId = parseUuid(input.automationArtifactId);
  const permission = input.intent === "SUBMIT" ? "automation:submit" : "automation:approve";
  const { workspace, projectId } = await context(input, permission, dependencies);

  return client(dependencies).$transaction(async (transaction) => {
    const artifact = await transaction.automationArtifact.findUnique({
      where: {
        organizationId_projectId_id: {
          organizationId: workspace.organization.id,
          projectId,
          id: automationArtifactId,
        },
      },
      include: {
        versions: {
          orderBy: { versionNumber: "desc" },
          take: 1,
        },
      },
    });
    if (!artifact || artifact.status === "ARCHIVED") {
      throw new AutomationArtifactDomainError("automation_artifact_not_found", 404);
    }
    const currentVersion = artifact.versions[0];
    if (!currentVersion || currentVersion.versionNumber !== artifact.currentVersionNumber) {
      throw new AutomationArtifactDomainError("automation_version_not_found", 404);
    }

    let from: "DRAFT" | "IN_REVIEW";
    let to: "DRAFT" | "IN_REVIEW" | "APPROVED";
    let action:
      | "AUTOMATION_SUBMITTED_FOR_REVIEW"
      | "AUTOMATION_CHANGES_REQUESTED"
      | "AUTOMATION_APPROVED";
    if (input.intent === "SUBMIT") {
      from = "DRAFT";
      to = "IN_REVIEW";
      action = "AUTOMATION_SUBMITTED_FOR_REVIEW";
      if (
        currentVersion.generationStatus !== "SUCCEEDED" ||
        currentVersion.validationStatus === "BLOCKED"
      ) {
        throw new AutomationArtifactDomainError("reviewable_automation_required", 409);
      }
    } else if (input.intent === "REQUEST_CHANGES") {
      from = "IN_REVIEW";
      to = "DRAFT";
      action = "AUTOMATION_CHANGES_REQUESTED";
    } else {
      from = "IN_REVIEW";
      to = "APPROVED";
      action = "AUTOMATION_APPROVED";
      if (
        currentVersion.generationStatus !== "SUCCEEDED" ||
        currentVersion.validationStatus === "BLOCKED"
      ) {
        throw new AutomationArtifactDomainError("reviewable_automation_required", 409);
      }
      const decision = await checkSelfApproval(transaction, {
        organizationId: workspace.organization.id,
        projectId,
        targetType: "AUTOMATION_ARTIFACT",
        targetId: artifact.id,
        submittedAction: "AUTOMATION_SUBMITTED_FOR_REVIEW",
        approverUserId: workspace.user.id,
      });
      if (!decision.allowed) {
        throw new AutomationArtifactDomainError("self_approval_not_allowed", 409);
      }
    }

    const update = await transaction.automationArtifact.updateMany({
      where: {
        id: artifact.id,
        organizationId: workspace.organization.id,
        projectId,
        status: from,
        currentVersionNumber: currentVersion.versionNumber,
      },
      data: {
        status: to,
        ...(input.intent === "SUBMIT"
          ? { submittedForReviewAt: new Date() }
          : input.intent === "REQUEST_CHANGES"
            ? { submittedForReviewAt: null }
            : {
                approvedVersionNumber: currentVersion.versionNumber,
                approvedByUserId: workspace.user.id,
                approvedAt: new Date(),
              }),
      },
    });
    if (update.count !== 1) {
      throw new AutomationArtifactDomainError("automation_transition_conflict", 409);
    }
    if (input.intent === "APPROVE") {
      const automationSummaryUpdate = await transaction.testCase.updateMany({
        where: {
          id: artifact.testCaseId,
          organizationId: workspace.organization.id,
          projectId,
        },
        data: { automationStatus: "AUTOMATED" },
      });
      if (automationSummaryUpdate.count !== 1) {
        throw new AutomationArtifactDomainError("test_case_not_found", 404);
      }
    }
    await transaction.activity.create({
      data: {
        organizationId: workspace.organization.id,
        projectId,
        actorUserId: workspace.user.id,
        source: "USER",
        action,
        targetType: "AUTOMATION_ARTIFACT",
        targetId: artifact.id,
        requestId: input.requestId ?? null,
        metadata: {
          testCaseId: artifact.testCaseId,
          testCaseVersionId: artifact.testCaseVersionId,
          engine: artifact.engine,
          versionNumber: currentVersion.versionNumber,
        },
      },
    });
    return transaction.automationArtifact.findUniqueOrThrow({
      where: { id: artifact.id },
    });
  });
}

type TransitionInput = {
  orgSlug?: string;
  projectId: string;
  automationArtifactId: string;
  requestId?: string;
};

export function submitAutomationArtifact(input: TransitionInput, dependencies?: Dependencies) {
  return transition({ ...input, intent: "SUBMIT" }, dependencies);
}

export function requestAutomationChanges(input: TransitionInput, dependencies?: Dependencies) {
  return transition({ ...input, intent: "REQUEST_CHANGES" }, dependencies);
}

export function approveAutomationArtifact(input: TransitionInput, dependencies?: Dependencies) {
  return transition({ ...input, intent: "APPROVE" }, dependencies);
}

export function automationArtifactDomainErrorResponse(error: unknown): Response | null {
  if (!(error instanceof AutomationArtifactDomainError)) return null;
  return Response.json({ status: "error", code: error.code }, { status: error.status });
}
