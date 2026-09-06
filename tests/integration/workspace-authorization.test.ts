import { randomUUID } from "node:crypto";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import type {
  MembershipRole,
  MembershipStatus,
  PrismaClient,
  ProjectMembershipRole,
} from "@/generated/prisma/client";
import {
  requireWorkspaceContext,
  WorkspaceAuthorizationError,
  workspaceAuthorizationErrorResponse,
} from "@/lib/auth/workspace-context";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

function uniqueValue(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

describe("tenant-safe workspace authorization", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await connectTestDatabase(prisma);
  });

  beforeEach(async () => {
    await cleanPhase1ATables(prisma);
  });

  afterAll(async () => {
    if (prisma) {
      await cleanPhase1ATables(prisma);
      await disconnectTestDatabase(prisma);
    }
  });

  async function createWorkspace(options: {
    organizationRole?: MembershipRole;
    membershipStatus?: MembershipStatus;
    projectRole?: ProjectMembershipRole;
    userStatus?: "ACTIVE" | "DISABLED" | "DELETED";
    organizationStatus?: "ACTIVE" | "SUSPENDED" | "ARCHIVED";
    projectStatus?: "ACTIVE" | "ARCHIVED";
  } = {}) {
    const clerkUserId = uniqueValue("clerk-user");
    const clerkOrganizationId = uniqueValue("clerk-org");
    const user = await prisma.user.create({
      data: {
        clerkUserId,
        status: options.userStatus ?? "ACTIVE",
      },
    });
    const organization = await prisma.organization.create({
      data: {
        clerkOrganizationId,
        name: "Authorization workspace",
        slug: uniqueValue("workspace"),
        status: options.organizationStatus ?? "ACTIVE",
      },
    });
    const membership = await prisma.membership.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: options.organizationRole ?? "MEMBER",
        status: options.membershipStatus ?? "ACTIVE",
      },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: organization.id,
        name: "Authorization project",
        slug: uniqueValue("project"),
        createdByUserId: user.id,
        status: options.projectStatus ?? "ACTIVE",
      },
    });
    const projectMembership = options.projectRole
      ? await prisma.projectMembership.create({
          data: {
            organizationId: organization.id,
            projectId: project.id,
            userId: user.id,
            role: options.projectRole,
          },
        })
      : null;

    return {
      clerkOrganizationId,
      clerkUserId,
      membership,
      organization,
      project,
      projectMembership,
      user,
    };
  }

  function dependencies(authState: {
    userId: string | null;
    orgId: string | null;
  }) {
    return {
      authenticate: async () => authState,
      prisma,
    };
  }

  async function expectAuthorizationError(
    promise: Promise<unknown>,
    status: 401 | 403 | 404,
    code: string,
  ) {
    await expect(promise).rejects.toMatchObject({ status, code });
  }

  it("recovers when Clerk knows an organization the database does not", async () => {
    // A missed webhook delivery used to lock a genuine member out of their own
    // workspace behind a bare "this page couldn't load". The organization is
    // created from Clerk instead, and the lookup retried.
    const workspace = await createWorkspace();
    const orphanOrgId = uniqueValue("clerk-org");

    let asked = 0;
    const context = await requireWorkspaceContext(
      { permission: "organization:read" },
      {
        authenticate: async () => ({
          userId: workspace.clerkUserId,
          orgId: orphanOrgId,
        }),
        prisma,
        provisionWorkspace: async ({ clerkOrganizationId }) => {
          asked += 1;
          await prisma.organization.create({
            data: {
              clerkOrganizationId,
              name: "Recovered workspace",
              slug: uniqueValue("recovered"),
            },
          });
          const organization = await prisma.organization.findUniqueOrThrow({
            where: { clerkOrganizationId },
          });
          const user = await prisma.user.findUniqueOrThrow({
            where: { clerkUserId: workspace.clerkUserId },
          });
          await prisma.membership.create({
            data: {
              organizationId: organization.id,
              userId: user.id,
              role: "OWNER",
            },
          });
          return true;
        },
      },
    );

    expect(asked).toBe(1);
    expect(context.organization.clerkOrganizationId).toBe(orphanOrgId);
  });

  it("still refuses when the organization cannot be recovered", async () => {
    // Provisioning runs on a path that was already failing, so when Clerk is
    // unreachable or returns nothing the original not-found has to stand rather
    // than be replaced by an error about provisioning.
    const workspace = await createWorkspace();

    await expectAuthorizationError(
      requireWorkspaceContext(
        {},
        {
          authenticate: async () => ({
            userId: workspace.clerkUserId,
            orgId: uniqueValue("clerk-org"),
          }),
          prisma,
          provisionWorkspace: async () => false,
        },
      ),
      404,
      "workspace_not_found",
    );
  });

  it("returns 401 when no Clerk user is authenticated", async () => {
    await expectAuthorizationError(
      requireWorkspaceContext(
        {},
        dependencies({ userId: null, orgId: null }),
      ),
      401,
      "unauthenticated",
    );
  });

  it("returns 403 when the session has no active organization", async () => {
    const workspace = await createWorkspace();
    await expectAuthorizationError(
      requireWorkspaceContext(
        {},
        dependencies({ userId: workspace.clerkUserId, orgId: null }),
      ),
      403,
      "organization_required",
    );
  });

  it("resolves synchronized active identity and Membership", async () => {
    const workspace = await createWorkspace({ organizationRole: "VIEWER" });
    const context = await requireWorkspaceContext(
      { permission: "organization:read" },
      dependencies({
        userId: workspace.clerkUserId,
        orgId: workspace.clerkOrganizationId,
      }),
    );

    expect(context.user.id).toBe(workspace.user.id);
    expect(context.organization.id).toBe(workspace.organization.id);
    expect(context.membership.id).toBe(workspace.membership.id);
    expect(context.effectiveRole).toBe("VIEWER");
  });

  it("returns 403 for removed Membership access", async () => {
    const workspace = await createWorkspace({ membershipStatus: "REMOVED" });
    await expectAuthorizationError(
      requireWorkspaceContext(
        {},
        dependencies({
          userId: workspace.clerkUserId,
          orgId: workspace.clerkOrganizationId,
        }),
      ),
      403,
      "workspace_forbidden",
    );
  });

  it("returns 403 for a disabled synchronized User", async () => {
    const workspace = await createWorkspace({ userStatus: "DISABLED" });
    await expectAuthorizationError(
      requireWorkspaceContext(
        {},
        dependencies({
          userId: workspace.clerkUserId,
          orgId: workspace.clerkOrganizationId,
        }),
      ),
      403,
      "workspace_forbidden",
    );
  });

  it("returns 404 for a caller-supplied foreign organization ID", async () => {
    const active = await createWorkspace();
    const foreign = await createWorkspace();
    await expectAuthorizationError(
      requireWorkspaceContext(
        { organizationId: foreign.organization.id },
        dependencies({
          userId: active.clerkUserId,
          orgId: active.clerkOrganizationId,
        }),
      ),
      404,
      "workspace_not_found",
    );
  });

  it("returns 404 when the organization slug is not the active tenant", async () => {
    const workspace = await createWorkspace();
    await expectAuthorizationError(
      requireWorkspaceContext(
        { orgSlug: uniqueValue("wrong-slug") },
        dependencies({
          userId: workspace.clerkUserId,
          orgId: workspace.clerkOrganizationId,
        }),
      ),
      404,
      "workspace_not_found",
    );
  });

  it("returns 404 for a project ID from another tenant", async () => {
    const active = await createWorkspace({ projectRole: "MEMBER" });
    const foreign = await createWorkspace();
    await expectAuthorizationError(
      requireWorkspaceContext(
        { projectId: foreign.project.id, permission: "project:read" },
        dependencies({
          userId: active.clerkUserId,
          orgId: active.clerkOrganizationId,
        }),
      ),
      404,
      "workspace_not_found",
    );
  });

  it("requires ProjectMembership for non-admin project access", async () => {
    const workspace = await createWorkspace({ organizationRole: "MEMBER" });
    await expectAuthorizationError(
      requireWorkspaceContext(
        { projectId: workspace.project.id, permission: "project:read" },
        dependencies({
          userId: workspace.clerkUserId,
          orgId: workspace.clerkOrganizationId,
        }),
      ),
      403,
      "workspace_forbidden",
    );
  });

  it("allows an assigned project Viewer to read only", async () => {
    const workspace = await createWorkspace({ projectRole: "VIEWER" });
    const context = await requireWorkspaceContext(
      { projectId: workspace.project.id, permission: "project:read" },
      dependencies({
        userId: workspace.clerkUserId,
        orgId: workspace.clerkOrganizationId,
      }),
    );

    expect(context.project?.id).toBe(workspace.project.id);
    expect(context.projectRole).toBe("VIEWER");
    expect(context.can("project:update")).toBe(false);
    expect(context.can("requirement:read")).toBe(true);
    expect(context.can("requirement:update")).toBe(false);
  });

  it("allows a Project Lead to update but not archive a project", async () => {
    const workspace = await createWorkspace({ projectRole: "PROJECT_LEAD" });
    const context = await requireWorkspaceContext(
      { projectId: workspace.project.id, permission: "project:update" },
      dependencies({
        userId: workspace.clerkUserId,
        orgId: workspace.clerkOrganizationId,
      }),
    );

    expect(context.effectiveRole).toBe("PROJECT_LEAD");
    expect(context.can("project:archive")).toBe(false);
    expect(context.can("requirement:create")).toBe(true);
    expect(context.can("requirement:submit")).toBe(true);
    expect(context.can("requirement:approve")).toBe(false);
  });

  it("returns 403 when a project Viewer requests update permission", async () => {
    const workspace = await createWorkspace({ projectRole: "VIEWER" });
    await expectAuthorizationError(
      requireWorkspaceContext(
        { projectId: workspace.project.id, permission: "project:update" },
        dependencies({
          userId: workspace.clerkUserId,
          orgId: workspace.clerkOrganizationId,
        }),
      ),
      403,
      "permission_denied",
    );
  });

  it("gives Owner organization-wide project authority", async () => {
    const workspace = await createWorkspace({ organizationRole: "OWNER" });
    const context = await requireWorkspaceContext(
      {
        projectId: workspace.project.id,
        permission: "project:members:manage",
      },
      dependencies({
        userId: workspace.clerkUserId,
        orgId: workspace.clerkOrganizationId,
      }),
    );

    expect(context.projectMembership).toBeNull();
    expect(context.can("project:archive")).toBe(true);
    expect(context.can("requirement:approve")).toBe(true);
    expect(context.can("requirement:archive")).toBe(true);
  });

  it("does not grant project mutation authority without project context", async () => {
    const workspace = await createWorkspace({ organizationRole: "OWNER" });
    await expectAuthorizationError(
      requireWorkspaceContext(
        { permission: "project:update" },
        dependencies({
          userId: workspace.clerkUserId,
          orgId: workspace.clerkOrganizationId,
        }),
      ),
      403,
      "permission_denied",
    );
  });

  it("requires explicit allowance for archived resources", async () => {
    const archivedProject = await createWorkspace({
      organizationRole: "ADMIN",
      projectStatus: "ARCHIVED",
    });
    await expectAuthorizationError(
      requireWorkspaceContext(
        { projectId: archivedProject.project.id },
        dependencies({
          userId: archivedProject.clerkUserId,
          orgId: archivedProject.clerkOrganizationId,
        }),
      ),
      404,
      "workspace_not_found",
    );

    const context = await requireWorkspaceContext(
      {
        projectId: archivedProject.project.id,
        allowArchivedProject: true,
      },
      dependencies({
        userId: archivedProject.clerkUserId,
        orgId: archivedProject.clerkOrganizationId,
      }),
    );
    expect(context.project?.status).toBe("ARCHIVED");
  });

  it("requires explicit allowance for an archived organization", async () => {
    const workspace = await createWorkspace({
      organizationRole: "ADMIN",
      organizationStatus: "ARCHIVED",
    });
    const authState = dependencies({
      userId: workspace.clerkUserId,
      orgId: workspace.clerkOrganizationId,
    });

    await expectAuthorizationError(
      requireWorkspaceContext({}, authState),
      404,
      "workspace_not_found",
    );
    expect(
      (await requireWorkspaceContext(
        { allowArchivedOrganization: true },
        authState,
      )).organization.status,
    ).toBe("ARCHIVED");
  });

  it("maps authorization errors to sanitized API responses", async () => {
    const error = new WorkspaceAuthorizationError("permission_denied", 403);
    const response = workspaceAuthorizationErrorResponse(error);

    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({
      status: "error",
      code: "permission_denied",
    });
    expect(workspaceAuthorizationErrorResponse(new Error("private"))).toBeNull();
  });
});
