import "server-only";

import { clerkClient } from "@clerk/nextjs/server";
import { isClerkAPIResponseError } from "@clerk/nextjs/errors";
import { z } from "zod";

import type { MembershipRole, ProjectMembershipRole } from "@/generated/prisma/client";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import {
  invitedProjectRolesMetadata,
  readInvitedProjectRoles,
} from "@/lib/services/invited-project-roles";

/**
 * Who works on a project, and in what capacity.
 *
 * The role rules -- members write, leads approve, nobody approves their own
 * work -- only mean something if a team can see and set them. Until now project
 * roles existed in the database with no screen at all, so every workspace was
 * in practice one owner doing everything. This is that screen's service.
 *
 * Owners and admins manage the team. Everyone on the project can see it,
 * because "waiting for a project lead to approve" is only useful to someone who
 * can find out who the leads are. Email addresses are shown to managers only.
 */

export class ProjectTeamError extends Error {
  constructor(
    readonly code:
      | "invalid_email"
      | "invalid_role"
      | "already_a_member"
      | "invitation_already_pending"
      | "invitation_failed",
    readonly status: 400 | 409 | 502,
  ) {
    super(code);
    this.name = "ProjectTeamError";
  }
}

export type PendingInvitation = {
  id: string;
  emailAddress: string;
  createdAt: Date;
  projectRole: ProjectMembershipRole | null;
};

/** The part of Clerk this feature needs; injectable so tests never call it. */
export type InvitationGateway = {
  create(input: {
    clerkOrganizationId: string;
    inviterClerkUserId: string;
    emailAddress: string;
    publicMetadata: Record<string, unknown>;
  }): Promise<void>;
  listPending(clerkOrganizationId: string): Promise<
    Array<{ id: string; emailAddress: string; createdAt: Date; publicMetadata: unknown }>
  >;
  revoke(input: {
    clerkOrganizationId: string;
    invitationId: string;
    requestingClerkUserId: string;
  }): Promise<void>;
};

const clerkInvitations: InvitationGateway = {
  async create(input) {
    const client = await clerkClient();
    await client.organizations.createOrganizationInvitation({
      organizationId: input.clerkOrganizationId,
      inviterUserId: input.inviterClerkUserId,
      emailAddress: input.emailAddress,
      role: "org:member",
      publicMetadata: input.publicMetadata,
    });
  },
  async listPending(clerkOrganizationId) {
    const client = await clerkClient();
    const page = await client.organizations.getOrganizationInvitationList({
      organizationId: clerkOrganizationId,
      status: ["pending"],
      limit: 100,
    });
    return page.data.map((invitation) => ({
      id: invitation.id,
      emailAddress: invitation.emailAddress,
      createdAt: new Date(invitation.createdAt),
      publicMetadata: invitation.publicMetadata,
    }));
  },
  async revoke(input) {
    const client = await clerkClient();
    await client.organizations.revokeOrganizationInvitation({
      organizationId: input.clerkOrganizationId,
      invitationId: input.invitationId,
      requestingUserId: input.requestingClerkUserId,
    });
  },
};

export type ProjectTeamDependencies = WorkspaceContextDependencies & {
  invitations?: InvitationGateway;
};

function db(dependencies?: ProjectTeamDependencies) {
  return dependencies?.prisma ?? getPrismaClient();
}

const ROLE_ORDER: Record<string, number> = {
  OWNER: 0,
  ADMIN: 1,
  PROJECT_LEAD: 2,
  MEMBER: 3,
  VIEWER: 4,
  NONE: 5,
};

export type TeamMember = {
  userId: string;
  name: string | null;
  email: string | null;
  organizationRole: MembershipRole;
  projectRole: ProjectMembershipRole | null;
  /** Owners and admins reach every project whatever their project role. */
  hasOrganizationWideAccess: boolean;
  isYou: boolean;
};

export async function getProjectTeam(
  input: { orgSlug?: string; projectId: string },
  dependencies?: ProjectTeamDependencies,
) {
  const context = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId: input.projectId, permission: "project:read" },
    dependencies,
  );
  const projectId = context.project!.id;
  const canManage = context.can("project:members:manage");

  const memberships = await db(dependencies).membership.findMany({
    where: {
      organizationId: context.organization.id,
      status: "ACTIVE",
      user: { status: "ACTIVE" },
    },
    select: {
      role: true,
      user: { select: { id: true, displayName: true, primaryEmail: true } },
      projectMemberships: {
        where: { projectId, status: "ACTIVE" },
        select: { role: true },
      },
    },
  });

  const members: TeamMember[] = memberships
    .map((membership) => {
      const hasOrganizationWideAccess =
        membership.role === "OWNER" || membership.role === "ADMIN";
      return {
        userId: membership.user.id,
        name: membership.user.displayName,
        email: canManage ? membership.user.primaryEmail : null,
        organizationRole: membership.role,
        projectRole: membership.projectMemberships[0]?.role ?? null,
        hasOrganizationWideAccess,
        isYou: membership.user.id === context.user.id,
      };
    })
    .sort((left, right) => {
      const rank = (member: TeamMember) =>
        ROLE_ORDER[
          member.hasOrganizationWideAccess
            ? member.organizationRole
            : member.projectRole ?? "NONE"
        ];
      return rank(left) - rank(right) || (left.name ?? "").localeCompare(right.name ?? "");
    });

  let pendingInvitations: PendingInvitation[] = [];
  let invitationsUnavailable = false;
  if (canManage) {
    try {
      const pending = await (dependencies?.invitations ?? clerkInvitations).listPending(
        context.organization.clerkOrganizationId,
      );
      pendingInvitations = pending.map((invitation) => ({
        id: invitation.id,
        emailAddress: invitation.emailAddress,
        createdAt: invitation.createdAt,
        projectRole:
          readInvitedProjectRoles(invitation.publicMetadata).find(
            (entry) => entry.projectId === projectId,
          )?.role ?? null,
      }));
    } catch {
      // The team list is still correct without them; say so rather than fail.
      invitationsUnavailable = true;
    }
  }

  return {
    project: context.project!,
    members,
    pendingInvitations,
    invitationsUnavailable,
    canManage,
  };
}

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const roleSchema = z.enum(["PROJECT_LEAD", "MEMBER", "VIEWER"]);

export async function inviteToProject(
  input: { orgSlug?: string; projectId: string; email: string; role: string },
  dependencies?: ProjectTeamDependencies,
) {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) throw new ProjectTeamError("invalid_email", 400);
  const role = roleSchema.safeParse(input.role);
  if (!role.success) throw new ProjectTeamError("invalid_role", 400);

  const context = await requireWorkspaceContext(
    {
      orgSlug: input.orgSlug,
      projectId: input.projectId,
      permission: "project:members:manage",
    },
    dependencies,
  );

  const alreadyMember = await db(dependencies).membership.findFirst({
    where: {
      organizationId: context.organization.id,
      status: "ACTIVE",
      user: { primaryEmail: { equals: email.data, mode: "insensitive" } },
    },
    select: { id: true },
  });
  if (alreadyMember) throw new ProjectTeamError("already_a_member", 409);

  try {
    await (dependencies?.invitations ?? clerkInvitations).create({
      clerkOrganizationId: context.organization.clerkOrganizationId,
      inviterClerkUserId: context.user.clerkUserId,
      emailAddress: email.data,
      publicMetadata: invitedProjectRolesMetadata([
        { projectId: context.project!.id, role: role.data },
      ]),
    });
  } catch (error) {
    if (isClerkAPIResponseError(error)) {
      const code = error.errors[0]?.code;
      if (code === "duplicate_record") {
        throw new ProjectTeamError("invitation_already_pending", 409);
      }
      if (code === "already_a_member_in_organization") {
        throw new ProjectTeamError("already_a_member", 409);
      }
      console.error("[project-team] Clerk rejected an invitation", {
        code,
        message: error.errors[0]?.message,
      });
    } else {
      console.error("[project-team] invitation failed", error);
    }
    throw new ProjectTeamError("invitation_failed", 502);
  }
  return { email: email.data, role: role.data };
}

export async function revokeProjectInvitation(
  input: { orgSlug?: string; projectId: string; invitationId: string },
  dependencies?: ProjectTeamDependencies,
) {
  const context = await requireWorkspaceContext(
    {
      orgSlug: input.orgSlug,
      projectId: input.projectId,
      permission: "project:members:manage",
    },
    dependencies,
  );
  if (!/^[A-Za-z0-9_]{1,100}$/.test(input.invitationId)) {
    throw new ProjectTeamError("invitation_failed", 400);
  }
  await (dependencies?.invitations ?? clerkInvitations).revoke({
    clerkOrganizationId: context.organization.clerkOrganizationId,
    invitationId: input.invitationId,
    requestingClerkUserId: context.user.clerkUserId,
  });
}

export function describeTeamError(error: unknown): string {
  const code =
    error instanceof ProjectTeamError
      ? error.code
      : typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "unknown";
  switch (code) {
    case "invalid_email":
      return "That doesn't look like an email address.";
    case "already_a_member":
      return "That person is already in this workspace. Give them a role in the list below.";
    case "invitation_already_pending":
      return "An invitation to that address is already waiting to be accepted.";
    case "invitation_failed":
      return "The invitation could not be sent. Please try again in a moment.";
    case "organization_member_not_found":
      return "That person is no longer in this workspace.";
    case "permission_denied":
      return "Only workspace owners and admins can change the team.";
    default:
      return "That change could not be saved. Please try again.";
  }
}

export const PROJECT_ROLE_LABEL: Record<ProjectMembershipRole, string> = {
  PROJECT_LEAD: "Lead",
  MEMBER: "Member",
  VIEWER: "Viewer",
};
