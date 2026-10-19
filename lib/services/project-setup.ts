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

/**
 * Tests that already ran and passed, waiting for a person.
 *
 * Covering a page leaves draft Test Cases behind, each with its code and the
 * signed receipt of the run that proved it. Every step of the chain below
 * still reads "not done", which is true and reads as an accusation: someone
 * who has just watched two tests pass on their own page is told they have
 * done nothing, and nothing on the screen says the drafts are there or what
 * to do with them.
 */
export type ProvenDrafts = {
  count: number;
  /** Where to send someone to deal with them. */
  href: string;
};

export type ProjectSetup = {
  steps: SetupStep[];
  completedCount: number;
  complete: boolean;
  provenDrafts: ProvenDrafts;
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
    tokenHolder,
    attempts,
    latestRequirement,
    approvedRequirement,
    approvedTestCase,
    provenDraftRows,
  ] = await Promise.all([
    prisma.requirement.count({ where: { ...scope, status: "APPROVED" } }),
    prisma.testCase.count({ where: { ...scope, status: "APPROVED" } }),
    prisma.requirementTestCase.count({ where: scope }),
    prisma.automationArtifact.count({ where: { ...scope, status: { not: "ARCHIVED" } } }),
    prisma.repositoryConnection.count({ where: { ...scope, status: "ACTIVE" } }),
    // Whether anybody can be named as the person behind CI results. A team
    // without a GitHub repository can now be attributable by taking the CI
    // token, and without this the step beside it would never tick for them --
    // a checklist that cannot be finished is worse than none.
    prisma.project.findFirst({
      where: { organizationId: scope.organizationId, id: scope.projectId },
      select: { runnerTokenActorUserId: true },
    }),
    prisma.testRunAttempt.count({ where: scope }),
    // Enough to send each button to the one screen where the step is done,
    // rather than to a list the person then has to search.
    prisma.requirement.findFirst({
      where: { ...scope, status: { in: ["DRAFT", "IN_REVIEW"] } },
      orderBy: { updatedAt: "desc" },
      select: { id: true, status: true },
    }),
    prisma.requirement.findFirst({
      where: { ...scope, status: "APPROVED" },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    }),
    prisma.testCase.findFirst({
      where: { ...scope, status: "APPROVED" },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    }),
    // A draft whose code was proven and has not yet become an automation
    // version: the run receipt is what makes it more than a suggestion.
    prisma.testCaseImportedDraft.findMany({
      // "passed", not merely "ran": a partial run also carries a receipt, and
      // calling that proven would be the overstatement the rest of the product
      // works to avoid.
      where: {
        ...scope,
        usedAt: null,
        runEvidence: { path: ["verdict"], equals: "passed" },
        testCase: { status: "DRAFT" },
      },
      orderBy: { createdAt: "desc" },
      select: { testCaseId: true },
      take: 20,
    }),
  ]);

  const steps: SetupStep[] = [
    {
      key: "requirement",
      title: "Approve a requirement",
      detail:
        "Coverage is measured against intent someone agreed to, so nothing counts until a requirement is approved.",
      done: approvedRequirements > 0,
      count: approvedRequirements,
      href: latestRequirement
        ? `${base}/requirements/${latestRequirement.id}`
        : `${base}/requirements/new`,
      actionLabel: !latestRequirement
        ? "Write a requirement"
        : latestRequirement.status === "IN_REVIEW"
          ? "Review and approve it"
          : "Finish and submit it",
    },
    {
      key: "test-case",
      title: "Approve a test case",
      detail: "An approved test case is the reviewed intent that automation and runs are pinned to.",
      done: approvedTestCases > 0,
      count: approvedTestCases,
      href: approvedRequirement
        ? `${base}/requirements/${approvedRequirement.id}`
        : `${base}/test-cases/new`,
      actionLabel: approvedRequirement ? "Let AI propose test cases" : "Design a test case",
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
      href: approvedTestCase ? `${base}/test-cases/${approvedTestCase.id}` : `${base}/automation`,
      actionLabel: approvedTestCase ? "Generate Playwright code" : "Generate",
    },
    {
      key: "repository",
      title: "Connect a repository, or take the CI token",
      // This said "Results are attributed to the person who connected the
      // repository, so this comes before reporting", which was exactly true
      // until 2026-10-19 and is the sentence that kept teams without a GitHub
      // repository out. Whoever takes the CI token is now recorded too, so
      // the step is about having somebody to name rather than about GitHub.
      detail:
        "Results are recorded under a real person: whoever connects the repository, or whoever takes this project's CI token. Both live on the Repositories page.",
      done: connections > 0 || Boolean(tokenHolder?.runnerTokenActorUserId),
      count: connections,
      href: `${base}/repositories`,
      actionLabel: "Open Repositories",
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

  const provenDrafts = {
    count: provenDraftRows.length,
    href: provenDraftRows.length === 1 ? `${base}/test-cases/${provenDraftRows[0].testCaseId}` : `${base}/test-cases`,
  };

  return { steps, completedCount, complete: completedCount === steps.length, provenDrafts };
}
