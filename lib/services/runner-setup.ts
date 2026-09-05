import "server-only";

import { z } from "zod";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { EnvironmentValidationError, validateRunnerIngestEnvironment } from "@/lib/env";
import { deriveProjectRunnerToken } from "@/lib/integrations/runner/ingest-token";

const uuidSchema = z.string().uuid();

export type RunnerSetup =
  | {
      configured: true;
      organizationId: string;
      projectId: string;
      tokenVersion: number;
      token: string;
    }
  | { configured: false };

function readIngestSecret(): string | null {
  try {
    return validateRunnerIngestEnvironment().RUNNER_INGEST_SECRET;
  } catch (error: unknown) {
    if (error instanceof EnvironmentValidationError) return null;
    throw error;
  }
}

/**
 * Returns the CI ingest credentials for one project.
 *
 * Gated on `repository:connect` because the token authorizes writing test
 * evidence into this project. It is deliberately not exposed to read-only
 * members, and it is never written to Activity or logs.
 *
 * When `RUNNER_INGEST_SECRET` is absent the caller gets `configured: false`
 * rather than an error, so the surface can explain the gap instead of failing.
 */
export async function getProjectRunnerSetup(
  input: { orgSlug?: string; projectId: string },
  dependencies?: WorkspaceContextDependencies,
): Promise<RunnerSetup> {
  const projectId = uuidSchema.parse(input.projectId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "repository:connect" },
    dependencies,
  );

  const secret = readIngestSecret();
  if (!secret) return { configured: false };

  const prisma = dependencies?.prisma ?? getPrismaClient();
  const project = await prisma.project.findFirstOrThrow({
    where: { organizationId: workspace.organization.id, id: projectId },
    select: { runnerTokenVersion: true },
  });

  return {
    configured: true,
    organizationId: workspace.organization.id,
    projectId,
    tokenVersion: project.runnerTokenVersion,
    token: deriveProjectRunnerToken({
      secret,
      organizationId: workspace.organization.id,
      projectId,
      tokenVersion: project.runnerTokenVersion,
    }),
  };
}

/**
 * Revokes this project's ingest token by advancing its version.
 *
 * Because the token is derived rather than stored, incrementing the version is
 * the revocation: the previous value stops verifying immediately and no other
 * project is affected. Any CI still holding the old token begins receiving 401s
 * until it is updated, which is the intended outcome of a revocation.
 *
 * Recorded as PROJECT_UPDATED with an explicit change marker. Rotating a
 * credential is an auditable act, and the metadata names it precisely without
 * requiring a new enum value. The token itself is never written to Activity.
 */
export async function rotateProjectRunnerToken(
  input: { orgSlug?: string; projectId: string; requestId?: string },
  dependencies?: WorkspaceContextDependencies,
): Promise<RunnerSetup> {
  const projectId = uuidSchema.parse(input.projectId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "repository:connect" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();

  const rotated = await prisma.$transaction(async (transaction) => {
    const project = await transaction.project.update({
      where: { organizationId_id: { organizationId: workspace.organization.id, id: projectId } },
      data: { runnerTokenVersion: { increment: 1 } },
      select: { runnerTokenVersion: true },
    });

    await transaction.activity.create({
      data: {
        organizationId: workspace.organization.id,
        projectId,
        actorUserId: workspace.user.id,
        source: "USER",
        action: "PROJECT_UPDATED",
        targetType: "PROJECT",
        targetId: projectId,
        requestId: input.requestId ?? null,
        metadata: {
          change: "runner_token_rotated",
          tokenVersion: project.runnerTokenVersion,
        },
      },
    });

    return project.runnerTokenVersion;
  });

  const secret = readIngestSecret();
  if (!secret) return { configured: false };

  return {
    configured: true,
    organizationId: workspace.organization.id,
    projectId,
    tokenVersion: rotated,
    token: deriveProjectRunnerToken({
      secret,
      organizationId: workspace.organization.id,
      projectId,
      tokenVersion: rotated,
    }),
  };
}
