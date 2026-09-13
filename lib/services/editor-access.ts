import "server-only";

import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { EnvironmentValidationError, validateRunnerIngestEnvironment } from "@/lib/env";
import {
  deriveEditorToken,
  editorTokenMatches,
  parseEditorToken,
} from "@/lib/integrations/editor/editor-token";

function readSecret(): string | null {
  try {
    return validateRunnerIngestEnvironment().RUNNER_INGEST_SECRET;
  } catch (error: unknown) {
    if (error instanceof EnvironmentValidationError) return null;
    throw error;
  }
}

/**
 * The signed-in person's own editor token for one project.
 *
 * Anyone who can read the project may connect an editor to it: the token only
 * reads, and it reads exactly what that person could already see in the
 * browser. It is shown to them alone and never logged.
 */
export async function getEditorSetup(
  input: { orgSlug?: string; projectId: string },
  dependencies?: WorkspaceContextDependencies,
): Promise<{ configured: true; token: string } | { configured: false }> {
  const projectId = z.string().uuid().parse(input.projectId);
  const context = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "testcase:read" },
    dependencies,
  );
  const secret = readSecret();
  if (!secret) return { configured: false };

  return {
    configured: true,
    token: deriveEditorToken({
      secret,
      organizationId: context.organization.id,
      projectId,
      userId: context.user.id,
      tokenVersion: context.project!.runnerTokenVersion,
    }),
  };
}

export type EditorSession = {
  orgSlug: string;
  projectId: string;
  projectName: string;
  /** Run every read through the same authorization as the web app. */
  dependencies: WorkspaceContextDependencies;
};

/**
 * Turns an `Authorization: Bearer` header into the person and project it
 * speaks for, or null.
 *
 * Every failure -- malformed, unknown project, wrong MAC, disabled user, access
 * since removed -- returns the same null, so the endpoint cannot be used to
 * learn which projects or people exist.
 */
export async function authenticateEditorRequest(
  authorization: string | null,
  options: { prisma?: PrismaClient; secret?: string | null } = {},
): Promise<EditorSession | null> {
  const presented = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!presented) return null;
  const claims = parseEditorToken(presented);
  if (!claims) return null;
  const secret = options.secret === undefined ? readSecret() : options.secret;
  if (!secret) return null;

  const prisma = options.prisma ?? getPrismaClient();
  const [project, user] = await Promise.all([
    prisma.project.findUnique({
      where: { id: claims.projectId },
      select: {
        id: true,
        name: true,
        status: true,
        organizationId: true,
        runnerTokenVersion: true,
        organization: { select: { clerkOrganizationId: true, slug: true } },
      },
    }),
    prisma.user.findUnique({
      where: { id: claims.userId },
      select: { id: true, clerkUserId: true, status: true },
    }),
  ]);
  if (!project || project.status !== "ACTIVE" || !user || user.status !== "ACTIVE") {
    return null;
  }
  if (
    !editorTokenMatches({
      presented,
      secret,
      organizationId: project.organizationId,
      projectId: project.id,
      userId: user.id,
      tokenVersion: project.runnerTokenVersion,
    })
  ) {
    return null;
  }

  const dependencies: WorkspaceContextDependencies = {
    prisma,
    authenticate: async () => ({
      userId: user.clerkUserId,
      orgId: project.organization.clerkOrganizationId,
    }),
    // The organization was just read, so there is nothing to recover.
    provisionWorkspace: async () => false,
    provisionMembership: async () => false,
  };

  // The same check the browser gets: an active membership, and a project role
  // or an organization-wide one. Losing either ends the session.
  try {
    await requireWorkspaceContext(
      { projectId: project.id, permission: "testcase:read" },
      dependencies,
    );
  } catch {
    return null;
  }

  return {
    orgSlug: project.organization.slug,
    projectId: project.id,
    projectName: project.name,
    dependencies,
  };
}
