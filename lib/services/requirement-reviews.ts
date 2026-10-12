import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import {
  reviewRequirementVersion,
  prepareRequirementReview,
  type RequirementReviewResult,
} from "@/lib/ai/requirement-review";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import {
  OrganizationAiRateLimitError,
  reserveOrganizationAiRequest,
} from "@/lib/operations/organization-ai-guard";

const PROMPT_VERSION = "requirement-review-v1";
const SCHEMA_VERSION = "requirement-review-schema-v1";
const uuidSchema = z.string().uuid();

type Dependencies = WorkspaceContextDependencies & {
  reviewer?: (input: {
    title: string;
    description: string;
    acceptanceCriteria: string;
    externalReference: string | null;
  }) => Promise<RequirementReviewResult>;
};

export class RequirementReviewDomainError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409 | 429 | 502 | 503;

  constructor(code: string, status: 400 | 404 | 409 | 429 | 502 | 503) {
    super(code);
    this.name = "RequirementReviewDomainError";
    this.code = code;
    this.status = status;
  }
}

function parseUuid(value: string): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) {
    throw new RequirementReviewDomainError("invalid_review_input", 400);
  }
  return result.data;
}

function client(dependencies?: Dependencies) {
  return dependencies?.prisma ?? getPrismaClient();
}

async function reviewContext(
  input: { orgSlug?: string; projectId: string },
  permission: "requirement:read" | "requirement:update",
  dependencies?: Dependencies,
) {
  const projectId = parseUuid(input.projectId);
  const context = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission },
    dependencies,
  );
  return { context, projectId };
}

export async function listRequirementReviews(
  input: { orgSlug?: string; projectId: string; requirementId: string },
  dependencies?: Dependencies,
) {
  const requirementId = parseUuid(input.requirementId);
  const { context, projectId } = await reviewContext(
    input,
    "requirement:read",
    dependencies,
  );
  return client(dependencies).aiRun.findMany({
    where: {
      organizationId: context.organization.id,
      projectId,
      requirementId,
      type: "REQUIREMENT_REVIEW",
    },
    include: {
      createdBy: { select: { displayName: true } },
      suggestions: { orderBy: [{ severity: "desc" }, { createdAt: "asc" }] },
    },
    orderBy: { startedAt: "desc" },
  });
}

export async function runRequirementReview(
  input: {
    orgSlug?: string;
    projectId: string;
    requirementId: string;
    versionNumber?: number;
    requestId?: string;
  },
  dependencies?: Dependencies,
) {
  const requirementId = parseUuid(input.requirementId);
  const { context, projectId } = await reviewContext(
    input,
    "requirement:update",
    dependencies,
  );
  const requirement = await client(dependencies).requirement.findUnique({
    where: {
      organizationId_projectId_id: {
        organizationId: context.organization.id,
        projectId,
        id: requirementId,
      },
    },
  });
  if (!requirement || requirement.status === "ARCHIVED") {
    throw new RequirementReviewDomainError("requirement_not_found", 404);
  }
  const versionNumber = input.versionNumber ?? requirement.currentVersionNumber;
  const version = await client(dependencies).requirementVersion.findUnique({
    where: {
      organizationId_projectId_requirementId_versionNumber: {
        organizationId: context.organization.id,
        projectId,
        requirementId,
        versionNumber,
      },
    },
  });
  if (!version) {
    throw new RequirementReviewDomainError("requirement_version_not_found", 404);
  }

  if (!dependencies?.reviewer) {
    try {
      await reserveOrganizationAiRequest({
        organizationId: context.organization.id,
        surface: "requirement-review",
      });
    } catch (error) {
      if (error instanceof OrganizationAiRateLimitError) {
        throw new RequirementReviewDomainError(error.code, 429);
      }
      throw new RequirementReviewDomainError("ai_guard_unavailable", 503);
    }
  }

  const configuredModel =
    process.env.OPENAI_REQUIREMENT_REVIEW_MODEL?.trim() || "gpt-4o";
  const run = await client(dependencies).aiRun.create({
    data: {
      organizationId: context.organization.id,
      projectId,
      requirementId,
      requirementVersionId: version.id,
      type: "REQUIREMENT_REVIEW",
      model: configuredModel,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      createdByUserId: context.user.id,
    },
  });
  const evidence = {
    title: version.title,
    description: version.description,
    acceptanceCriteria: version.acceptanceCriteria,
    externalReference: version.externalReference,
  };
  let result: RequirementReviewResult;
  try {
    result = await (dependencies?.reviewer ?? reviewRequirementVersion)(evidence);
    // Run for an injected reviewer too, and harmless for the real one: the
    // provider has already dropped what it could not support, and dropping
    // nothing a second time changes nothing.
    const prepared = prepareRequirementReview(result, evidence);
    result = { ...result, ...prepared.review };
  } catch (error) {
    const failureCode =
      error instanceof Error && /^[a-z_]+$/.test(error.message)
        ? error.message
        : "provider_failure";
    await client(dependencies).aiRun.update({
      where: { id: run.id },
      data: { status: "FAILED", failureCode, completedAt: new Date() },
    });
    // The code reached a database column and nothing else, so a review that
    // failed the same way every time looked like one unexplained crash page.
    // A provider outage and a reading this product refused to store are not
    // the same thing to whoever has to fix it. No requirement text is logged:
    // the code and the run are enough to find the row.
    console.error(`[requirement-review] ${failureCode} (ai run ${run.id})`);
    throw new RequirementReviewDomainError("requirement_review_failed", 502);
  }

  return client(dependencies).$transaction(async (transaction) => {
    await transaction.aiRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        model: result.model,
        summary: result.summary,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
        completedAt: new Date(),
      },
    });
    if (result.suggestions.length > 0) {
      await transaction.aiSuggestion.createMany({
        data: result.suggestions.map((suggestion) => ({
          organizationId: context.organization.id,
          projectId,
          requirementId,
          requirementVersionId: version.id,
          aiRunId: run.id,
          ...suggestion,
        })),
      });
    }
    await transaction.activity.create({
      data: {
        organizationId: context.organization.id,
        projectId,
        actorUserId: context.user.id,
        source: "USER",
        action: "REQUIREMENT_REVIEW_COMPLETED",
        targetType: "AI_RUN",
        targetId: run.id,
        requestId: input.requestId ?? null,
        metadata: {
          requirementId,
          versionNumber,
          suggestionCount: result.suggestions.length,
          promptVersion: PROMPT_VERSION,
          schemaVersion: SCHEMA_VERSION,
        } satisfies Prisma.InputJsonObject,
      },
    });
    return transaction.aiRun.findUniqueOrThrow({
      where: { id: run.id },
      include: { suggestions: true },
    });
  });
}

export async function resolveAiSuggestion(
  input: {
    orgSlug?: string;
    projectId: string;
    requirementId: string;
    suggestionId: string;
    resolution: "ACCEPTED" | "DISMISSED";
    requestId?: string;
  },
  dependencies?: Dependencies,
) {
  const requirementId = parseUuid(input.requirementId);
  const suggestionId = parseUuid(input.suggestionId);
  const { context, projectId } = await reviewContext(
    input,
    "requirement:update",
    dependencies,
  );
  return client(dependencies).$transaction(async (transaction) => {
    const update = await transaction.aiSuggestion.updateMany({
      where: {
        id: suggestionId,
        organizationId: context.organization.id,
        projectId,
        requirementId,
        status: "OPEN",
      },
      data: {
        status: input.resolution,
        resolvedByUserId: context.user.id,
        resolvedAt: new Date(),
      },
    });
    if (update.count !== 1) {
      throw new RequirementReviewDomainError("suggestion_not_open", 409);
    }
    await transaction.activity.create({
      data: {
        organizationId: context.organization.id,
        projectId,
        actorUserId: context.user.id,
        source: "USER",
        action:
          input.resolution === "ACCEPTED"
            ? "AI_SUGGESTION_ACCEPTED"
            : "AI_SUGGESTION_DISMISSED",
        targetType: "AI_SUGGESTION",
        targetId: suggestionId,
        requestId: input.requestId ?? null,
        metadata: { requirementId },
      },
    });
    return transaction.aiSuggestion.findUniqueOrThrow({
      where: { id: suggestionId },
    });
  });
}
