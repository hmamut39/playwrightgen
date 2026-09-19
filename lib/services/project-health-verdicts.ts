import "server-only";

import type { WorkspaceContextDependencies } from "@/lib/auth/workspace-context";
import { readLiveChecksSummary } from "@/lib/services/live-checks";
import { projectHealthVerdict, type HealthVerdict } from "@/lib/services/project-health";
import { getReleaseReadiness } from "@/lib/services/release-readiness";

/** Readiness reads a project's whole run history, so the home page stops here. */
export const HEALTH_VERDICT_PROJECT_LIMIT = 12;

/**
 * The Health page's verdict for each active project on the workspace home,
 * computed by the same rules from the same records. A project whose readiness
 * cannot be read by this person, or that falls past the limit, gets no verdict
 * rather than a guessed one.
 */
export async function getProjectHealthVerdicts(
  input: {
    orgSlug: string;
    projects: Array<{ id: string; status: string; liveChecksEnabled: boolean; liveChecksLastSummary: unknown }>;
  },
  dependencies?: WorkspaceContextDependencies,
): Promise<Map<string, { verdict: HealthVerdict; reasons: string[] }>> {
  const active = input.projects.filter((project) => project.status === "ACTIVE").slice(0, HEALTH_VERDICT_PROJECT_LIMIT);
  const entries = await Promise.all(
    active.map(async (project) => {
      try {
        const readiness = await getReleaseReadiness({ orgSlug: input.orgSlug, projectId: project.id }, dependencies);
        const live = project.liveChecksEnabled
          ? readLiveChecksSummary(project.liveChecksLastSummary as Parameters<typeof readLiveChecksSummary>[0])
          : null;
        return [[project.id, projectHealthVerdict({ readiness, live })] as const];
      } catch {
        return [];
      }
    }),
  );
  return new Map(entries.flat());
}
