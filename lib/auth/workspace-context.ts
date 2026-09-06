import "server-only";

import { auth } from "@clerk/nextjs/server";

import type {
  Membership,
  Organization,
  PrismaClient,
  Project,
  ProjectMembership,
  User,
} from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { provisionWorkspaceFromClerk } from "@/lib/auth/workspace-provisioning";

export type WorkspacePermission =
  | "organization:read"
  | "organization:manage"
  | "project:create"
  | "project:read"
  | "project:update"
  | "project:archive"
  | "project:members:manage"
  | "requirement:read"
  | "requirement:create"
  | "requirement:update"
  | "requirement:submit"
  | "requirement:approve"
  | "requirement:archive"
  | "testcase:read"
  | "testcase:create"
  | "testcase:update"
  | "testcase:submit"
  | "testcase:approve"
  | "testcase:archive"
  | "testcase:traceability"
  | "testrun:read"
  | "testrun:create"
  | "testrun:record"
  | "testrun:cancel"
  | "failure:read"
  | "failure:analyze"
  | "failure:resolve"
  | "automation:read"
  | "automation:generate"
  | "automation:submit"
  | "automation:approve"
  | "repository:read"
  | "repository:connect"
  | "repository:import";

export type WorkspaceAuthorizationErrorCode =
  | "unauthenticated"
  | "organization_required"
  | "workspace_forbidden"
  | "workspace_not_found"
  | "permission_denied";

export class WorkspaceAuthorizationError extends Error {
  readonly code: WorkspaceAuthorizationErrorCode;
  readonly status: 401 | 403 | 404;

  constructor(
    code: WorkspaceAuthorizationErrorCode,
    status: 401 | 403 | 404,
  ) {
    super(code);
    this.name = "WorkspaceAuthorizationError";
    this.code = code;
    this.status = status;
  }
}

type WorkspaceAuthState = {
  userId: string | null;
  orgId: string | null;
};

export type WorkspaceContextDependencies = {
  authenticate: () => Promise<WorkspaceAuthState>;
  prisma: PrismaClient;
  /** Injectable so tests can exercise the recovery path without calling Clerk. */
  provisionWorkspace?: (input: {
    clerkOrganizationId: string;
    prisma: PrismaClient;
  }) => Promise<boolean>;
};

export type RequireWorkspaceContextInput = {
  organizationId?: string;
  orgSlug?: string;
  projectId?: string;
  permission?: WorkspacePermission;
  allowArchivedOrganization?: boolean;
  allowArchivedProject?: boolean;
};

export type WorkspaceContext = {
  user: User;
  organization: Organization;
  membership: Membership;
  project: Project | null;
  projectMembership: ProjectMembership | null;
  organizationRole: Membership["role"];
  projectRole: ProjectMembership["role"] | null;
  effectiveRole: Membership["role"] | ProjectMembership["role"];
  can: (permission: WorkspacePermission) => boolean;
};

function notFound(): never {
  throw new WorkspaceAuthorizationError("workspace_not_found", 404);
}

function forbidden(
  code: Extract<
    WorkspaceAuthorizationErrorCode,
    "organization_required" | "workspace_forbidden" | "permission_denied"
  > = "workspace_forbidden",
): never {
  throw new WorkspaceAuthorizationError(code, 403);
}

function hasPermission(input: {
  permission: WorkspacePermission;
  organizationRole: Membership["role"];
  projectRole: ProjectMembership["role"] | null;
  hasProject: boolean;
}): boolean {
  if (
    input.permission !== "organization:read" &&
    input.permission !== "organization:manage" &&
    input.permission !== "project:create" &&
    !input.hasProject
  ) {
    return false;
  }

  if (
    input.organizationRole === "OWNER" ||
    input.organizationRole === "ADMIN"
  ) {
    return true;
  }

  if (input.permission === "organization:read") {
    return true;
  }

  if (!input.hasProject || !input.projectRole) {
    return false;
  }

  if (
    input.permission === "project:read" ||
    input.permission === "requirement:read" ||
    input.permission === "testcase:read" ||
    input.permission === "testrun:read" ||
    input.permission === "failure:read" ||
    input.permission === "automation:read" ||
    input.permission === "repository:read"
  ) {
    return true;
  }

  if (
    input.permission === "testrun:create" ||
    input.permission === "testrun:record" ||
    input.permission === "failure:analyze" ||
    input.permission === "automation:generate"
  ) {
    return input.projectRole !== "VIEWER";
  }

  return (
    (input.permission === "project:update" ||
      input.permission === "requirement:create" ||
      input.permission === "requirement:update" ||
      input.permission === "requirement:submit" ||
      input.permission === "testcase:create" ||
      input.permission === "testcase:update" ||
      input.permission === "testcase:submit" ||
      input.permission === "testcase:traceability" ||
      input.permission === "testrun:cancel" ||
      input.permission === "failure:resolve" ||
      input.permission === "automation:submit" ||
      input.permission === "repository:connect" ||
      input.permission === "repository:import") &&
    input.projectRole === "PROJECT_LEAD"
  );
}

async function defaultAuthenticate(): Promise<WorkspaceAuthState> {
  const authState = await auth();
  return {
    userId: authState.userId ?? null,
    orgId: authState.orgId ?? null,
  };
}

export async function requireWorkspaceContext(
  input: RequireWorkspaceContextInput = {},
  dependencies?: WorkspaceContextDependencies,
): Promise<WorkspaceContext> {
  const authState = await (
    dependencies?.authenticate ?? defaultAuthenticate
  )();

  if (!authState.userId) {
    throw new WorkspaceAuthorizationError("unauthenticated", 401);
  }
  if (!authState.orgId) {
    forbidden("organization_required");
  }

  const prisma = dependencies?.prisma ?? getPrismaClient();

  const lookup = () =>
    Promise.all([
      prisma.user.findUnique({
        where: { clerkUserId: authState.userId as string },
      }),
      prisma.organization.findUnique({
        where: { clerkOrganizationId: authState.orgId as string },
      }),
    ]);

  let [user, organization] = await lookup();

  // Clerk says this person is a member of an organization the database has
  // never heard of, which happens when a webhook delivery was missed. Rather
  // than lock someone out of their own workspace with a bare error, the mirror
  // is created from Clerk and the lookup retried once. If that does not
  // succeed, the original not-found stands.
  if (!organization) {
    const provisioned = await (
      dependencies?.provisionWorkspace ?? provisionWorkspaceFromClerk
    )({ clerkOrganizationId: authState.orgId, prisma });
    if (provisioned) {
      [user, organization] = await lookup();
    }
  }

  if (!organization) {
    notFound();
  }
  if (
    input.organizationId &&
    input.organizationId !== organization.id
  ) {
    notFound();
  }
  if (input.orgSlug && input.orgSlug !== organization.slug) {
    notFound();
  }
  if (
    organization.status === "ARCHIVED" &&
    !input.allowArchivedOrganization
  ) {
    notFound();
  }
  if (organization.status === "SUSPENDED") {
    forbidden();
  }
  if (!user || user.status !== "ACTIVE") {
    forbidden();
  }

  const membership = await prisma.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id,
      },
    },
  });

  if (!membership || membership.status !== "ACTIVE") {
    forbidden();
  }

  let project: Project | null = null;
  let projectMembership: ProjectMembership | null = null;

  if (input.projectId) {
    project = await prisma.project.findUnique({
      where: {
        organizationId_id: {
          organizationId: organization.id,
          id: input.projectId,
        },
      },
    });

    if (!project) {
      notFound();
    }
    if (project.status === "ARCHIVED" && !input.allowArchivedProject) {
      notFound();
    }

    if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
      projectMembership =
        await prisma.projectMembership.findUnique({
          where: {
            organizationId_projectId_userId: {
              organizationId: organization.id,
              projectId: project.id,
              userId: user.id,
            },
          },
        });

      if (!projectMembership || projectMembership.status !== "ACTIVE") {
        forbidden();
      }
    }
  }

  const can = (permission: WorkspacePermission) =>
    hasPermission({
      permission,
      organizationRole: membership.role,
      projectRole: projectMembership?.role ?? null,
      hasProject: Boolean(project),
    });

  if (input.permission && !can(input.permission)) {
    forbidden("permission_denied");
  }

  return {
    user,
    organization,
    membership,
    project,
    projectMembership,
    organizationRole: membership.role,
    projectRole: projectMembership?.role ?? null,
    effectiveRole: projectMembership?.role ?? membership.role,
    can,
  };
}

export function workspaceAuthorizationErrorResponse(
  error: unknown,
): Response | null {
  if (!(error instanceof WorkspaceAuthorizationError)) {
    return null;
  }

  return Response.json(
    { status: "error", code: error.code },
    { status: error.status },
  );
}
