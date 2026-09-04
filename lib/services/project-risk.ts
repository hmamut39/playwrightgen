import "server-only";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { classifyRuns } from "@/lib/services/run-signals";

/**
 * A compact risk summary for every project in one organization.
 *
 * The Projects list previously showed only a name and a status, so a lead with
 * several projects had to open each one to discover which was in trouble. This
 * surfaces the few facts that change what someone does next, computed for the
 * whole organization in a fixed number of queries rather than per project.
 *
 * Deliberately not a score. Each number is a direct count a reader can open and
 * verify, and a project with no evidence is reported as having none rather than
 * as healthy.
 */
export type ProjectRisk = {
  regressions: number;
  flaky: number;
  openFindings: number;
  lastEvidenceAt: Date | null;
};

export async function getOrganizationProjectRisk(
  input: { orgSlug?: string },
  dependencies?: WorkspaceContextDependencies,
): Promise<Map<string, ProjectRisk>> {
  // Organization-scoped rather than project-scoped: the authorization guard
  // rejects project permissions when no project is in scope, and this query
  // deliberately spans every project the organization owns. It reads the same
  // set the Projects list already renders.
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, permission: "organization:read" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();
  const organizationId = workspace.organization.id;

  const [attemptRows, findingGroups] = await Promise.all([
    prisma.testRunAttempt.findMany({
      where: { organizationId },
      select: {
        projectId: true,
        testRunId: true,
        attemptNumber: true,
        result: true,
        commitSha: true,
        executedAt: true,
        testRun: { select: { testCaseId: true, testCaseVersionId: true } },
      },
      orderBy: { executedAt: "asc" },
    }),
    prisma.failureFinding.groupBy({
      by: ["projectId"],
      where: { organizationId, status: "OPEN" },
      _count: { _all: true },
    }),
  ]);

  const openByProject = new Map(
    findingGroups.map((group) => [group.projectId, group._count._all]),
  );

  // Runs are classified once across the organization, then attributed to the
  // project each run belongs to.
  const signals = classifyRuns(
    attemptRows.map((row) => ({
      testRunId: row.testRunId,
      testCaseId: row.testRun.testCaseId,
      testCaseVersionId: row.testRun.testCaseVersionId,
      attemptNumber: row.attemptNumber,
      result: row.result,
      commitSha: row.commitSha,
      executedAt: row.executedAt,
    })),
  );

  const projectOfRun = new Map(attemptRows.map((row) => [row.testRunId, row.projectId]));
  const latestEvidence = new Map<string, Date>();
  for (const row of attemptRows) {
    const current = latestEvidence.get(row.projectId);
    if (!current || row.executedAt > current) latestEvidence.set(row.projectId, row.executedAt);
  }

  const risk = new Map<string, ProjectRisk>();
  const ensure = (projectId: string) => {
    const existing = risk.get(projectId);
    if (existing) return existing;
    const created: ProjectRisk = {
      regressions: 0,
      flaky: 0,
      openFindings: openByProject.get(projectId) ?? 0,
      lastEvidenceAt: latestEvidence.get(projectId) ?? null,
    };
    risk.set(projectId, created);
    return created;
  };

  for (const [testRunId, verdict] of signals) {
    const projectId = projectOfRun.get(testRunId);
    if (!projectId) continue;
    const entry = ensure(projectId);
    if (verdict.signal === "REGRESSION") entry.regressions += 1;
    if (verdict.signal === "FLAKY") entry.flaky += 1;
  }

  for (const projectId of openByProject.keys()) ensure(projectId);
  for (const projectId of latestEvidence.keys()) ensure(projectId);

  return risk;
}
