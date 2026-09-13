import { z } from "zod";

import type { Prisma, ProjectMembershipRole } from "@/generated/prisma/client";

/**
 * Project roles chosen at the moment someone is invited.
 *
 * Joining a workspace grants no project access on its own -- an ordinary member
 * sees nothing until someone assigns them to a project -- so an invitation that
 * stopped at the workspace would leave the new colleague looking at an empty
 * screen, and the person who invited them with a second chore they would not
 * know they had. The role is therefore chosen with the invitation and applied
 * when it is accepted.
 *
 * It travels in the invitation's public metadata, which Clerk copies onto the
 * membership it creates and which only our server can write, so the webhook
 * can trust it. It is still checked against this organization's own projects:
 * metadata is data, and a project id from anywhere else is ignored.
 */
export const INVITED_PROJECT_ROLES_KEY = "playwrightgenProjectRoles";

const MAX_INVITED_PROJECTS = 50;

const rolesSchema = z.record(
  z.string().uuid(),
  z.enum(["PROJECT_LEAD", "MEMBER", "VIEWER"]),
);

export type InvitedProjectRole = { projectId: string; role: ProjectMembershipRole };

export function invitedProjectRolesMetadata(
  roles: readonly InvitedProjectRole[],
): Record<string, Record<string, ProjectMembershipRole>> {
  return {
    [INVITED_PROJECT_ROLES_KEY]: Object.fromEntries(
      roles.map((entry) => [entry.projectId, entry.role]),
    ),
  };
}

/** Malformed or absent metadata means "no project roles", never an error. */
export function readInvitedProjectRoles(metadata: unknown): InvitedProjectRole[] {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = (metadata as Record<string, unknown>)[INVITED_PROJECT_ROLES_KEY];
  const parsed = rolesSchema.safeParse(raw);
  if (!parsed.success) return [];
  return Object.entries(parsed.data)
    .slice(0, MAX_INVITED_PROJECTS)
    .map(([projectId, role]) => ({ projectId, role }));
}

/**
 * Gives a newly joined member the project roles they were invited with.
 *
 * Only projects with no membership row at all are touched. A row that exists
 * -- active, or removed on purpose by an admin -- is a later decision than the
 * invitation and wins, which also makes a redelivered webhook harmless.
 */
export async function applyInvitedProjectRoles(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    userId: string;
    roles: readonly InvitedProjectRole[];
    eventId?: string;
  },
): Promise<number> {
  if (input.roles.length === 0) return 0;

  const projects = await transaction.project.findMany({
    where: {
      organizationId: input.organizationId,
      id: { in: input.roles.map((entry) => entry.projectId) },
      status: "ACTIVE",
    },
    select: { id: true },
  });
  const activeProjectIds = new Set(projects.map((project) => project.id));

  let applied = 0;
  for (const entry of input.roles) {
    if (!activeProjectIds.has(entry.projectId)) continue;
    const existing = await transaction.projectMembership.findUnique({
      where: {
        organizationId_projectId_userId: {
          organizationId: input.organizationId,
          projectId: entry.projectId,
          userId: input.userId,
        },
      },
      select: { id: true },
    });
    if (existing) continue;

    const projectMembership = await transaction.projectMembership.create({
      data: {
        organizationId: input.organizationId,
        projectId: entry.projectId,
        userId: input.userId,
        role: entry.role,
      },
    });
    await transaction.activity.create({
      data: {
        organizationId: input.organizationId,
        projectId: entry.projectId,
        source: "CLERK_WEBHOOK",
        action: "PROJECT_MEMBER_ASSIGNED",
        targetType: "PROJECT_MEMBERSHIP",
        targetId: projectMembership.id,
        requestId: input.eventId ?? null,
        metadata: { changedFields: ["role", "status"], via: "invitation", role: entry.role },
      },
    });
    applied += 1;
  }
  return applied;
}
