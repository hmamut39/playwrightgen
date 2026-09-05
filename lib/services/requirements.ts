import "server-only";

import { z } from "zod";

import type {
  Prisma,
  RequirementSource,
  RequirementStatus,
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
const contentSchema = z.string().trim().max(50_000);
const externalReferenceSchema = z.string().trim().max(500).nullable();
const sourceSchema = z.enum(["MANUAL", "IMPORTED", "AI_SUGGESTED"]);
const versionSchema = z.number().int().positive();

type RequirementServiceDependencies = WorkspaceContextDependencies;

export class RequirementDomainError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409;

  constructor(code: string, status: 400 | 404 | 409) {
    super(code);
    this.name = "RequirementDomainError";
    this.code = code;
    this.status = status;
  }
}

function client(dependencies?: RequirementServiceDependencies) {
  return dependencies?.prisma ?? getPrismaClient();
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new RequirementDomainError("invalid_requirement_input", 400);
  }
  return result.data;
}

function activityMetadata(
  values: Prisma.InputJsonObject,
): Prisma.InputJsonObject {
  return values;
}

async function requireProjectContext(
  input: { orgSlug?: string; projectId: string },
  permission: WorkspacePermission,
  dependencies?: RequirementServiceDependencies,
) {
  const projectId = parseOrThrow(uuidSchema, input.projectId);
  const context = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission },
    dependencies,
  );
  return { context, projectId };
}

async function findRequirementOrThrow(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    projectId: string;
    requirementId: string;
    allowArchived?: boolean;
  },
) {
  const requirement = await transaction.requirement.findUnique({
    where: {
      organizationId_projectId_id: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        id: input.requirementId,
      },
    },
  });
  if (!requirement || (requirement.status === "ARCHIVED" && !input.allowArchived)) {
    throw new RequirementDomainError("requirement_not_found", 404);
  }
  return requirement;
}

export async function listRequirements(
  input: {
    projectId: string;
    orgSlug?: string;
    includeArchived?: boolean;
  } & ListParams,
  dependencies?: RequirementServiceDependencies,
) {
  const { context, projectId } = await requireProjectContext(
    input,
    "requirement:read",
    dependencies,
  );
  const params = parseListParams(input);
  // Title and external reference: people search for a requirement either by what
  // it says or by the ticket it came from.
  const where = {
    organizationId: context.organization.id,
    projectId,
    ...(input.includeArchived ? {} : { status: { not: "ARCHIVED" as const } }),
    ...(params.contains
      ? {
          OR: [
            { title: params.contains },
            { externalReference: params.contains },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    client(dependencies).requirement.findMany({
      where,
      include: {
        owner: { select: { id: true, displayName: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: params.skip,
      take: params.take,
    }),
    client(dependencies).requirement.count({ where }),
  ]);

  return buildListResult(items, total, params);
}

export async function getRequirementDetail(
  input: {
    projectId: string;
    requirementId: string;
    orgSlug?: string;
    allowArchived?: boolean;
  },
  dependencies?: RequirementServiceDependencies,
) {
  const requirementId = parseOrThrow(uuidSchema, input.requirementId);
  const { context, projectId } = await requireProjectContext(
    input,
    "requirement:read",
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
    include: {
      owner: { select: { id: true, displayName: true } },
      createdBy: { select: { id: true, displayName: true } },
      versions: {
        include: {
          createdBy: { select: { id: true, displayName: true } },
        },
        orderBy: { versionNumber: "desc" },
      },
    },
  });
  if (!requirement || (requirement.status === "ARCHIVED" && !input.allowArchived)) {
    throw new RequirementDomainError("requirement_not_found", 404);
  }

  return {
    requirement,
    canUpdate: context.can("requirement:update"),
    canSubmit: context.can("requirement:submit"),
    canApprove: context.can("requirement:approve"),
    canArchive: context.can("requirement:archive"),
  };
}

export async function createRequirement(
  input: {
    projectId: string;
    orgSlug?: string;
    title: string;
    description?: string;
    acceptanceCriteria?: string;
    source?: RequirementSource;
    externalReference?: string | null;
    requestId?: string;
  },
  dependencies?: RequirementServiceDependencies,
) {
  const data = parseOrThrow(
    z.object({
      title: titleSchema,
      description: contentSchema.optional(),
      acceptanceCriteria: contentSchema.optional(),
      source: sourceSchema.optional(),
      externalReference: externalReferenceSchema.optional(),
    }),
    input,
  );
  const { context, projectId } = await requireProjectContext(
    input,
    "requirement:create",
    dependencies,
  );

  return client(dependencies).$transaction(async (transaction) => {
    const requirement = await transaction.requirement.create({
      data: {
        organizationId: context.organization.id,
        projectId,
        title: data.title,
        description: data.description ?? "",
        acceptanceCriteria: data.acceptanceCriteria ?? "",
        source: data.source ?? "MANUAL",
        externalReference: data.externalReference ?? null,
        ownerUserId: context.user.id,
        createdByUserId: context.user.id,
      },
    });
    await transaction.requirementVersion.create({
      data: {
        organizationId: context.organization.id,
        projectId,
        requirementId: requirement.id,
        versionNumber: 1,
        title: requirement.title,
        description: requirement.description,
        acceptanceCriteria: requirement.acceptanceCriteria,
        source: requirement.source,
        externalReference: requirement.externalReference,
        ownerUserId: requirement.ownerUserId,
        createdByUserId: context.user.id,
      },
    });
    await transaction.activity.create({
      data: {
        organizationId: context.organization.id,
        projectId,
        actorUserId: context.user.id,
        source: "USER",
        action: "REQUIREMENT_CREATED",
        targetType: "REQUIREMENT",
        targetId: requirement.id,
        requestId: input.requestId ?? null,
        metadata: activityMetadata({ versionNumber: 1, status: "DRAFT" }),
      },
    });
    return requirement;
  });
}

export async function updateRequirementDraft(
  input: {
    projectId: string;
    requirementId: string;
    expectedVersion: number;
    orgSlug?: string;
    title?: string;
    description?: string;
    acceptanceCriteria?: string;
    source?: RequirementSource;
    externalReference?: string | null;
    requestId?: string;
  },
  dependencies?: RequirementServiceDependencies,
) {
  const requirementId = parseOrThrow(uuidSchema, input.requirementId);
  const expectedVersion = parseOrThrow(versionSchema, input.expectedVersion);
  const patch = parseOrThrow(
    z
      .object({
        title: titleSchema.optional(),
        description: contentSchema.optional(),
        acceptanceCriteria: contentSchema.optional(),
        source: sourceSchema.optional(),
        externalReference: externalReferenceSchema.optional(),
      })
      .refine((value) => Object.values(value).some((item) => item !== undefined)),
    input,
  );
  const { context, projectId } = await requireProjectContext(
    input,
    "requirement:update",
    dependencies,
  );

  return client(dependencies).$transaction(async (transaction) => {
    const existing = await findRequirementOrThrow(transaction, {
      organizationId: context.organization.id,
      projectId,
      requirementId,
    });
    if (existing.status !== "DRAFT") {
      throw new RequirementDomainError("requirement_not_editable", 409);
    }
    if (existing.currentVersionNumber !== expectedVersion) {
      throw new RequirementDomainError("requirement_version_conflict", 409);
    }

    const next = {
      title: patch.title ?? existing.title,
      description: patch.description ?? existing.description,
      acceptanceCriteria:
        patch.acceptanceCriteria ?? existing.acceptanceCriteria,
      source: patch.source ?? existing.source,
      externalReference:
        patch.externalReference === undefined
          ? existing.externalReference
          : patch.externalReference,
    };
    const changedFields = (Object.keys(next) as Array<keyof typeof next>).filter(
      (field) => next[field] !== existing[field],
    );
    if (changedFields.length === 0) {
      return existing;
    }

    const versionNumber = existing.currentVersionNumber + 1;
    const update = await transaction.requirement.updateMany({
      where: {
        organizationId: context.organization.id,
        projectId,
        id: requirementId,
        status: "DRAFT",
        currentVersionNumber: expectedVersion,
      },
      data: { ...next, currentVersionNumber: versionNumber },
    });
    if (update.count !== 1) {
      throw new RequirementDomainError("requirement_version_conflict", 409);
    }

    await transaction.requirementVersion.create({
      data: {
        organizationId: context.organization.id,
        projectId,
        requirementId,
        versionNumber,
        ...next,
        ownerUserId: existing.ownerUserId,
        createdByUserId: context.user.id,
      },
    });
    await transaction.activity.create({
      data: {
        organizationId: context.organization.id,
        projectId,
        actorUserId: context.user.id,
        source: "USER",
        action: "REQUIREMENT_UPDATED",
        targetType: "REQUIREMENT",
        targetId: requirementId,
        requestId: input.requestId ?? null,
        metadata: activityMetadata({
          versionNumber,
          changedFields: changedFields.sort(),
        }),
      },
    });
    return transaction.requirement.findUniqueOrThrow({
      where: {
        organizationId_projectId_id: {
          organizationId: context.organization.id,
          projectId,
          id: requirementId,
        },
      },
    });
  });
}

async function transitionRequirement(
  input: {
    projectId: string;
    requirementId: string;
    orgSlug?: string;
    requestId?: string;
  },
  transition: {
    permission: WorkspacePermission;
    from: readonly RequirementStatus[];
    to: RequirementStatus;
    action:
      | "REQUIREMENT_SUBMITTED_FOR_REVIEW"
      | "REQUIREMENT_CHANGES_REQUESTED"
      | "REQUIREMENT_APPROVED"
      | "REQUIREMENT_ARCHIVED";
  },
  dependencies?: RequirementServiceDependencies,
) {
  const requirementId = parseOrThrow(uuidSchema, input.requirementId);
  const { context, projectId } = await requireProjectContext(
    input,
    transition.permission,
    dependencies,
  );

  return client(dependencies).$transaction(async (transaction) => {
    const existing = await findRequirementOrThrow(transaction, {
      organizationId: context.organization.id,
      projectId,
      requirementId,
    });
    if (!transition.from.includes(existing.status)) {
      throw new RequirementDomainError("invalid_requirement_transition", 409);
    }
    if (
      transition.to === "IN_REVIEW" &&
      (!existing.description.trim() || !existing.acceptanceCriteria.trim())
    ) {
      throw new RequirementDomainError("requirement_review_incomplete", 409);
    }

    const now = new Date();
    const update = await transaction.requirement.updateMany({
      where: {
        organizationId: context.organization.id,
        projectId,
        id: requirementId,
        status: { in: [...transition.from] },
        currentVersionNumber: existing.currentVersionNumber,
      },
      data: {
        status: transition.to,
        ...(transition.to === "IN_REVIEW"
          ? { submittedForReviewAt: now, approvedAt: null }
          : {}),
        ...(transition.to === "DRAFT"
          ? { submittedForReviewAt: null, approvedAt: null }
          : {}),
        ...(transition.to === "APPROVED" ? { approvedAt: now } : {}),
        ...(transition.to === "ARCHIVED" ? { archivedAt: now } : {}),
      },
    });
    if (update.count !== 1) {
      throw new RequirementDomainError("invalid_requirement_transition", 409);
    }
    await transaction.activity.create({
      data: {
        organizationId: context.organization.id,
        projectId,
        actorUserId: context.user.id,
        source: "USER",
        action: transition.action,
        targetType: "REQUIREMENT",
        targetId: requirementId,
        requestId: input.requestId ?? null,
        metadata: activityMetadata({
          fromStatus: existing.status,
          toStatus: transition.to,
          versionNumber: existing.currentVersionNumber,
        }),
      },
    });
    return transaction.requirement.findUniqueOrThrow({
      where: {
        organizationId_projectId_id: {
          organizationId: context.organization.id,
          projectId,
          id: requirementId,
        },
      },
    });
  });
}

export function submitRequirementForReview(
  input: {
    projectId: string;
    requirementId: string;
    orgSlug?: string;
    requestId?: string;
  },
  dependencies?: RequirementServiceDependencies,
) {
  return transitionRequirement(
    input,
    {
      permission: "requirement:submit",
      from: ["DRAFT"],
      to: "IN_REVIEW",
      action: "REQUIREMENT_SUBMITTED_FOR_REVIEW",
    },
    dependencies,
  );
}

export function requestRequirementChanges(
  input: {
    projectId: string;
    requirementId: string;
    orgSlug?: string;
    requestId?: string;
  },
  dependencies?: RequirementServiceDependencies,
) {
  return transitionRequirement(
    input,
    {
      permission: "requirement:approve",
      from: ["IN_REVIEW"],
      to: "DRAFT",
      action: "REQUIREMENT_CHANGES_REQUESTED",
    },
    dependencies,
  );
}

export function approveRequirement(
  input: {
    projectId: string;
    requirementId: string;
    orgSlug?: string;
    requestId?: string;
  },
  dependencies?: RequirementServiceDependencies,
) {
  return transitionRequirement(
    input,
    {
      permission: "requirement:approve",
      from: ["IN_REVIEW"],
      to: "APPROVED",
      action: "REQUIREMENT_APPROVED",
    },
    dependencies,
  );
}

export function archiveRequirement(
  input: {
    projectId: string;
    requirementId: string;
    orgSlug?: string;
    requestId?: string;
  },
  dependencies?: RequirementServiceDependencies,
) {
  return transitionRequirement(
    input,
    {
      permission: "requirement:archive",
      from: ["DRAFT", "IN_REVIEW", "APPROVED"],
      to: "ARCHIVED",
      action: "REQUIREMENT_ARCHIVED",
    },
    dependencies,
  );
}

export function requirementDomainErrorResponse(error: unknown): Response | null {
  if (!(error instanceof RequirementDomainError)) {
    return null;
  }
  return Response.json(
    { status: "error", code: error.code },
    { status: error.status },
  );
}
