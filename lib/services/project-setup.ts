import "server-only";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";

/**
 * The chain a project has to complete before its evidence means anything.
 *
 * A new project shows zero everywhere, which is accurate and completely
 * unhelpful: it says what is missing without saying what to do. Someone seeing
 * "0 of 0" for the first time has no way to learn that approved intent comes
 * first, that a test case has to be linked to be counted as coverage, or that
 * evidence only appears once something has run.
 *
 * This is not a tutorial bolted onto the side. The steps are the product's own
 * model — approved Requirement, approved Test Case, traceability link, reviewed
 * automation, connected repository, recorded evidence — so following it teaches
 * how the product thinks while the person uses it, and it keeps working
 * afterwards as a plain statement of what a project is still missing.
 *
 * Counts only, so this stays cheap enough to render on every project view.
 */

export type SetupStep = {
  key: string;
  title: string;
  /** Why this step exists, in terms of what it makes possible. */
  detail: string;
  done: boolean;
  count: number;
  href: string;
  actionLabel: string;
};

export type ProjectSetup = {
  steps: SetupStep[];
  completedCount: number;
  complete: boolean;
};

export async function getProjectSetup(
  input: { orgSlug?: string; projectId: string },
  dependencies?: WorkspaceContextDependencies,
): Promise<ProjectSetup> {
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId: input.projectId, permission: "project:read" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();
  const organizationId = workspace.organization.id;
  const projectId = input.projectId;
  const scope = { organizationId, projectId };
  const base = `/workspace/${workspace.organization.slug}/projects/${projectId}`;

  const [
    approvedRequirements,
    approvedTestCases,
    links,
    automation,
    connections,
    attempts,
  ] = await Promise.all([
    prisma.requirement.count({ where: { ...scope, status: "APPROVED" } }),
    prisma.testCase.count({ where: { ...scope, status: "APPROVED" } }),
    prisma.requirementTestCase.count({ where: scope }),
    prisma.automationArtifact.count({ where: { ...scope, status: { not: "ARCHIVED" } } }),
    prisma.repositoryConnection.count({ where: { ...scope, status: "ACTIVE" } }),
    prisma.testRunAttempt.count({ where: scope }),
  ]);

  const steps: SetupStep[] = [
    {
      key: "requirement",
      title: "Approve a requirement",
      detail:
        "Coverage is measured against intent someone agreed to, so nothing counts until a requirement is approved.",
      done: approvedRequirements > 0,
      count: approvedRequirements,
      href: `${base}/requirements`,
      actionLabel: "Write a requirement",
    },
    {
      key: "test-case",
      title: "Approve a test case",
      detail: "An approved test case is the reviewed intent that automation and runs are pinned to.",
      done: approvedTestCases > 0,
      count: approvedTestCases,
      href: `${base}/test-cases`,
      actionLabel: "Design a test case",
    },
    {
      key: "link",
      title: "Link the test case to the requirement",
      detail:
        "The link is what turns a test into coverage. Without it the requirement still reads as unverified.",
      done: links > 0,
      count: links,
      href: `${base}/test-cases`,
      actionLabel: "Link them",
    },
    {
      key: "automation",
      title: "Generate automation",
      detail:
        "Generated code is pinned to the approved version it covers, so a later result attaches to the right evidence.",
      done: automation > 0,
      count: automation,
      href: `${base}/automation`,
      actionLabel: "Generate",
    },
    {
      key: "repository",
      title: "Connect a repository",
      detail: "Results are attributed to the person who connected the repository, so this comes before reporting.",
      done: connections > 0,
      count: connections,
      href: `${base}/repositories`,
      actionLabel: "Connect GitHub",
    },
    {
      key: "evidence",
      title: "Record run evidence",
      detail:
        "Until something runs there is nothing to judge. An empty queue is not the same as a passing one.",
      done: attempts > 0,
      count: attempts,
      href: `${base}/test-runs`,
      actionLabel: "Set up CI",
    },
  ];

  const completedCount = steps.filter((step) => step.done).length;

  return { steps, completedCount, complete: completedCount === steps.length };
}
