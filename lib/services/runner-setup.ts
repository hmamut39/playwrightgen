import "server-only";

import { z } from "zod";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { EnvironmentValidationError, validateRunnerIngestEnvironment } from "@/lib/env";
import { deriveProjectRunnerToken } from "@/lib/integrations/runner/ingest-token";

const uuidSchema = z.string().uuid();

export type RunnerSetup =
  | {
      configured: true;
      organizationId: string;
      projectId: string;
      token: string;
    }
  | { configured: false };

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

  let secret: string;
  try {
    secret = validateRunnerIngestEnvironment().RUNNER_INGEST_SECRET;
  } catch (error: unknown) {
    if (error instanceof EnvironmentValidationError) return { configured: false };
    throw error;
  }

  return {
    configured: true,
    organizationId: workspace.organization.id,
    projectId,
    token: deriveProjectRunnerToken({
      secret,
      organizationId: workspace.organization.id,
      projectId,
    }),
  };
}
