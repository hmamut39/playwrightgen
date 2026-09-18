import "server-only";

import { z } from "zod";

import type {
  Prisma,
  ProjectMembershipRole,
} from "@/generated/prisma/client";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { isPublicWebAddress } from "@/lib/free-tools/public-address";

const nameSchema = z.string().trim().min(1).max(200);
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const descriptionSchema = z.string().trim().max(10_000).nullable();
const uuidSchema = z.string().uuid();
const projectRoleSchema = z.enum(["PROJECT_LEAD", "MEMBER", "VIEWER"]);

export class ProjectDomainError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409;

  constructor(code: string, status: 400 | 404 | 409) {
    super(code);
    this.name = "ProjectDomainError";
    this.code = code;
    this.status = status;
  }
}

type ProjectServiceDependencies = WorkspaceContextDependencies;

function client(dependencies?: ProjectServiceDependencies) {
  return dependencies?.prisma ?? getPrismaClient();
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ProjectDomainError("invalid_project_input", 400);
  }
  return result.data;
}

function activityMetadata(
  changedFields: readonly string[],
): Prisma.InputJsonObject {
  return { changedFields: [...new Set(changedFields)].sort() };
}

export async function listProjects(
  input: { orgSlug?: string; includeArchived?: boolean } = {},
  dependencies?: ProjectServiceDependencies,
) {
  const context = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, permission: "organization:read" },
    dependencies,
  );
  const isOrganizationAdmin =
    context.organizationRole === "OWNER" ||
    context.organizationRole === "ADMIN";

  return client(dependencies).project.findMany({
    where: {
      organizationId: context.organization.id,
      ...(input.includeArchived ? {} : { status: "ACTIVE" }),
      ...(isOrganizationAdmin
        ? {}
        : {
            projectMemberships: {
              some: {
                organizationId: context.organization.id,
                userId: context.user.id,
                status: "ACTIVE",
              },
            },
          }),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
  });
}

export async function getProject(
  input: {
    projectId: string;
    orgSlug?: string;
    allowArchived?: boolean;
  },
  dependencies?: ProjectServiceDependencies,
) {
  const projectId = parseOrThrow(uuidSchema, input.projectId);
  const context = await requireWorkspaceContext(
    {
      orgSlug: input.orgSlug,
      projectId,
      permission: "project:read",
      allowArchivedProject: input.allowArchived,
    },
    dependencies,
  );
  if (!context.project) {
    throw new ProjectDomainError("project_not_found", 404);
  }
  return context.project;
}

export async function getProjectOverview(
  input: {
    projectId: string;
    orgSlug?: string;
    allowArchived?: boolean;
  },
  dependencies?: ProjectServiceDependencies,
) {
  const projectId = parseOrThrow(uuidSchema, input.projectId);
  const context = await requireWorkspaceContext(
    {
      orgSlug: input.orgSlug,
      projectId,
      permission: "project:read",
      allowArchivedProject: input.allowArchived,
    },
    dependencies,
  );
  const project = await client(dependencies).project.findUniqueOrThrow({
    where: {
      organizationId_id: {
        organizationId: context.organization.id,
        id: projectId,
      },
    },
    include: {
      createdBy: {
        select: { id: true, displayName: true },
      },
    },
  });

  return {
    project,
    role: context.projectRole ?? context.organizationRole,
    canArchive: context.can("project:archive"),
    canUpdate: context.can("project:update"),
  };
}

export async function createProject(
  input: {
    name: string;
    slug: string;
    description?: string | null;
    orgSlug?: string;
    requestId?: string;
  },
  dependencies?: ProjectServiceDependencies,
) {
  const data = parseOrThrow(
    z.object({
      name: nameSchema,
      slug: slugSchema,
      description: descriptionSchema.optional(),
    }),
    input,
  );
  const context = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, permission: "project:create" },
    dependencies,
  );

  return client(dependencies).$transaction(async (transaction) => {
    const project = await transaction.project.create({
      data: {
        organizationId: context.organization.id,
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        createdByUserId: context.user.id,
      },
    });
    await transaction.activity.create({
      data: {
        organizationId: context.organization.id,
        projectId: project.id,
        actorUserId: context.user.id,
        source: "USER",
        action: "PROJECT_CREATED",
        targetType: "PROJECT",
        targetId: project.id,
        requestId: input.requestId ?? null,
        metadata: activityMetadata(["name", "slug", "description", "status"]),
      },
    });
    return project;
  });
}

export async function updateProject(
  input: {
    projectId: string;
    name?: string;
    description?: string | null;
    /** Where this project runs, so generated automation can be proven on it. "" clears it. */
    liveUrl?: string | null;
    orgSlug?: string;
    requestId?: string;
  },
  dependencies?: ProjectServiceDependencies,
) {
  const projectId = parseOrThrow(uuidSchema, input.projectId);
  const data = parseOrThrow(
    z
      .object({
        name: nameSchema.optional(),
        description: descriptionSchema.optional(),
        liveUrl: z
          .string()
          .trim()
          .max(2_000)
          .nullable()
          .optional()
          .transform((value) => (value ? value : value === undefined ? undefined : null))
          .refine(
            (value) => value === undefined || value === null || isPublicWebAddress(value),
            "liveUrl must be a public web address",
          ),
      })
      .refine(
        (value) =>
          value.name !== undefined || value.description !== undefined || value.liveUrl !== undefined,
      ),
    input,
  );
  const context = await requireWorkspaceContext(
    {
      orgSlug: input.orgSlug,
      projectId,
      permission: "project:update",
    },
    dependencies,
  );
  const changedFields = [
    ...(data.name !== undefined ? ["name"] : []),
    ...(data.description !== undefined ? ["description"] : []),
    ...(data.liveUrl !== undefined ? ["liveUrl"] : []),
  ];

  return client(dependencies).$transaction(async (transaction) => {
    const project = await transaction.project.update({
      where: {
        organizationId_id: {
          organizationId: context.organization.id,
          id: projectId,
        },
      },
      data,
    });
    await transaction.activity.create({
      data: {
        organizationId: context.organization.id,
        projectId,
        actorUserId: context.user.id,
        source: "USER",
        action: "PROJECT_UPDATED",
        targetType: "PROJECT",
        targetId: projectId,
        requestId: input.requestId ?? null,
        metadata: activityMetadata(changedFields),
      },
    });
    return project;
  });
}

async function transitionProjectStatus(
  input: {
    projectId: string;
    orgSlug?: string;
    requestId?: string;
  },
  status: "ACTIVE" | "ARCHIVED",
  dependencies?: ProjectServiceDependencies,
) {
  const projectId = parseOrThrow(uuidSchema, input.projectId);
  const context = await requireWorkspaceContext(
    {
      orgSlug: input.orgSlug,
      projectId,
      permission: "project:archive",
      allowArchivedProject: status === "ACTIVE",
    },
    dependencies,
  );

  if (context.project?.status === status) {
    return context.project;
  }

  return client(dependencies).$transaction(async (transaction) => {
    const project = await transaction.project.update({
      where: {
        organizationId_id: {
          organizationId: context.organization.id,
          id: projectId,
        },
      },
      data: {
        status,
        archivedAt: status === "ARCHIVED" ? new Date() : null,
        archivedByUserId: status === "ARCHIVED" ? context.user.id : null,
      },
    });
    await transaction.activity.create({
      data: {
        organizationId: context.organization.id,
        projectId,
        actorUserId: context.user.id,
        source: "USER",
        action: status === "ARCHIVED" ? "PROJECT_ARCHIVED" : "PROJECT_RESTORED",
        targetType: "PROJECT",
        targetId: projectId,
        requestId: input.requestId ?? null,
        metadata: activityMetadata(["status", "archivedAt", "archivedByUserId"]),
      },
    });
    return project;
  });
}

export function archiveProject(
  input: { projectId: string; orgSlug?: string; requestId?: string },
  dependencies?: ProjectServiceDependencies,
) {
  return transitionProjectStatus(input, "ARCHIVED", dependencies);
}

export function restoreProject(
  input: { projectId: string; orgSlug?: string; requestId?: string },
  dependencies?: ProjectServiceDependencies,
) {
  return transitionProjectStatus(input, "ACTIVE", dependencies);
}

async function requireMemberManagement(
  projectId: string,
  orgSlug: string | undefined,
  dependencies?: ProjectServiceDependencies,
) {
  return requireWorkspaceContext(
    {
      orgSlug,
      projectId,
      permission: "project:members:manage",
      allowArchivedProject: false,
    },
    dependencies,
  );
}

async function requireActiveOrganizationMember(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
) {
  const membership = await transaction.membership.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!membership || membership.status !== "ACTIVE") {
    throw new ProjectDomainError("organization_member_not_found", 404);
  }
  return membership;
}

export async function assignProjectMember(
  input: {
    projectId: string;
    userId: string;
    role: ProjectMembershipRole;
    orgSlug?: string;
    requestId?: string;
  },
  dependencies?: ProjectServiceDependencies,
) {
  const projectId = parseOrThrow(uuidSchema, input.projectId);
  const userId = parseOrThrow(uuidSchema, input.userId);
  const role = parseOrThrow(projectRoleSchema, input.role);
  const context = await requireMemberManagement(
    projectId,
    input.orgSlug,
    dependencies,
  );
  return client(dependencies).$transaction(async (transaction) => {
    await requireActiveOrganizationMember(
      transaction,
      context.organization.id,
      userId,
    );
    const existing = await transaction.projectMembership.findUnique({
      where: {
        organizationId_projectId_userId: {
          organizationId: context.organization.id,
          projectId,
          userId,
        },
      },
    });
    if (
      existing?.status === "ACTIVE" &&
      existing.role === role
    ) {
      return existing;
    }
    const projectMembership = existing
      ? await transaction.projectMembership.update({
          where: { id: existing.id },
          data: { role, status: "ACTIVE", removedAt: null },
        })
      : await transaction.projectMembership.create({
          data: {
            organizationId: context.organization.id,
            projectId,
            userId,
            role,
          },
        });
    await transaction.activity.create({
      data: {
        organizationId: context.organization.id,
        projectId,
        actorUserId: context.user.id,
        source: "USER",
        action:
          existing?.status === "ACTIVE"
            ? "PROJECT_MEMBER_ROLE_CHANGED"
            : "PROJECT_MEMBER_ASSIGNED",
        targetType: "PROJECT_MEMBERSHIP",
        targetId: projectMembership.id,
        requestId: input.requestId ?? null,
        metadata: activityMetadata(["role", "status", "removedAt"]),
      },
    });
    return projectMembership;
  });
}

export async function changeProjectMemberRole(
  input: {
    projectId: string;
    userId: string;
    role: ProjectMembershipRole;
    orgSlug?: string;
    requestId?: string;
  },
  dependencies?: ProjectServiceDependencies,
) {
  const projectId = parseOrThrow(uuidSchema, input.projectId);
  const userId = parseOrThrow(uuidSchema, input.userId);
  const role = parseOrThrow(projectRoleSchema, input.role);
  const context = await requireMemberManagement(
    projectId,
    input.orgSlug,
    dependencies,
  );
  return client(dependencies).$transaction(async (transaction) => {
    await requireActiveOrganizationMember(
      transaction,
      context.organization.id,
      userId,
    );
    const existing = await transaction.projectMembership.findUnique({
      where: {
        organizationId_projectId_userId: {
          organizationId: context.organization.id,
          projectId,
          userId,
        },
      },
    });
    if (!existing || existing.status !== "ACTIVE") {
      throw new ProjectDomainError("project_member_not_found", 404);
    }
    if (existing.role === role) {
      return existing;
    }
    const projectMembership = await transaction.projectMembership.update({
      where: { id: existing.id },
      data: { role },
    });
    await transaction.activity.create({
      data: {
        organizationId: context.organization.id,
        projectId,
        actorUserId: context.user.id,
        source: "USER",
        action: "PROJECT_MEMBER_ROLE_CHANGED",
        targetType: "PROJECT_MEMBERSHIP",
        targetId: projectMembership.id,
        requestId: input.requestId ?? null,
        metadata: activityMetadata(["role"]),
      },
    });
    return projectMembership;
  });
}

export async function removeProjectMember(
  input: {
    projectId: string;
    userId: string;
    orgSlug?: string;
    requestId?: string;
  },
  dependencies?: ProjectServiceDependencies,
) {
  const projectId = parseOrThrow(uuidSchema, input.projectId);
  const userId = parseOrThrow(uuidSchema, input.userId);
  const context = await requireMemberManagement(
    projectId,
    input.orgSlug,
    dependencies,
  );

  return client(dependencies).$transaction(async (transaction) => {
    const existing = await transaction.projectMembership.findUnique({
      where: {
        organizationId_projectId_userId: {
          organizationId: context.organization.id,
          projectId,
          userId,
        },
      },
    });
    if (!existing || existing.status !== "ACTIVE") {
      throw new ProjectDomainError("project_member_not_found", 404);
    }
    const projectMembership = await transaction.projectMembership.update({
      where: { id: existing.id },
      data: { status: "REMOVED", removedAt: new Date() },
    });
    await transaction.activity.create({
      data: {
        organizationId: context.organization.id,
        projectId,
        actorUserId: context.user.id,
        source: "USER",
        action: "PROJECT_MEMBER_REMOVED",
        targetType: "PROJECT_MEMBERSHIP",
        targetId: projectMembership.id,
        requestId: input.requestId ?? null,
        metadata: activityMetadata(["status", "removedAt"]),
      },
    });
    return projectMembership;
  });
}

export function projectDomainErrorResponse(error: unknown): Response | null {
  if (!(error instanceof ProjectDomainError)) {
    return null;
  }
  return Response.json(
    { status: "error", code: error.code },
    { status: error.status },
  );
}
