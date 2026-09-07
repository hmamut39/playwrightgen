import "server-only";

import type { ActivityAction, ActivityTargetType } from "@/generated/prisma/client";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { buildListResult, parseListParams, type ListParams } from "@/lib/services/list-query";

/**
 * What has happened, in the order it happened.
 *
 * Forty-one kinds of event were already being recorded -- every approval, every
 * version, every run, every AI suggestion, with the person and the moment --
 * and none of it was shown anywhere. That is the difference between a tool
 * someone configures once and one they open in the morning: nothing told them
 * what changed while they were away, so there was no reason to look.
 *
 * Nothing new is written here. This reads a table the product has been filling
 * since the first commit and finally puts it in front of the people it is about.
 *
 * Bounded and paged: an audit trail only grows, so a feed that fetched all of it
 * would get slower every day it was useful.
 */

export type ActivityEntry = {
  id: string;
  action: ActivityAction;
  targetType: ActivityTargetType;
  targetId: string;
  actorName: string | null;
  createdAt: Date;
  /** Plain-language description of what happened. */
  summary: string;
  /** Where to go to see it, when the target has a page. */
  href: string | null;
};

/**
 * Written as sentences rather than shouted enum names. A feed of
 * TEST_CASE_SUBMITTED_FOR_REVIEW reads like a log file; a feed of "submitted a
 * test case for review" reads like what a colleague did.
 */
const actionSummary: Record<ActivityAction, string> = {
  ORGANIZATION_UPDATED: "updated the workspace",
  MEMBERSHIP_ROLE_CHANGED: "changed a member's role",
  MEMBERSHIP_REMOVED: "removed a member",
  PROJECT_CREATED: "created the project",
  PROJECT_UPDATED: "updated the project",
  PROJECT_ARCHIVED: "archived the project",
  PROJECT_RESTORED: "restored the project",
  PROJECT_MEMBER_ASSIGNED: "added someone to the project",
  PROJECT_MEMBER_ROLE_CHANGED: "changed a project role",
  PROJECT_MEMBER_REMOVED: "removed someone from the project",
  REQUIREMENT_CREATED: "created a requirement",
  REQUIREMENT_UPDATED: "revised a requirement",
  REQUIREMENT_SUBMITTED_FOR_REVIEW: "submitted a requirement for review",
  REQUIREMENT_CHANGES_REQUESTED: "sent a requirement back for changes",
  REQUIREMENT_APPROVED: "approved a requirement",
  REQUIREMENT_ARCHIVED: "archived a requirement",
  REQUIREMENT_REVIEW_COMPLETED: "ran an AI review of a requirement",
  AI_SUGGESTION_ACCEPTED: "accepted an AI suggestion",
  AI_SUGGESTION_DISMISSED: "dismissed an AI suggestion",
  TEST_CASE_CREATED: "created a test case",
  TEST_CASE_UPDATED: "revised a test case",
  TEST_CASE_SUBMITTED_FOR_REVIEW: "submitted a test case for review",
  TEST_CASE_CHANGES_REQUESTED: "sent a test case back for changes",
  TEST_CASE_APPROVED: "approved a test case",
  TEST_CASE_ARCHIVED: "archived a test case",
  TEST_CASE_REQUIREMENT_LINKED: "linked a test case to a requirement",
  TEST_CASE_REQUIREMENT_UNLINKED: "unlinked a test case from a requirement",
  TEST_RUN_CREATED: "created a test run",
  TEST_RUN_ATTEMPT_RECORDED: "recorded run evidence",
  TEST_RUN_CANCELED: "canceled a test run",
  FAILURE_ANALYSIS_COMPLETED: "analyzed a failure",
  FAILURE_FINDING_CONFIRMED: "confirmed a failure finding",
  FAILURE_FINDING_DISMISSED: "dismissed a failure finding",
  AUTOMATION_ARTIFACT_CREATED: "started an automation artifact",
  AUTOMATION_VERSION_GENERATED: "generated automation",
  AUTOMATION_SUBMITTED_FOR_REVIEW: "submitted automation for review",
  AUTOMATION_CHANGES_REQUESTED: "sent automation back for changes",
  AUTOMATION_APPROVED: "approved automation",
  GITHUB_INSTALLATION_CONNECTED: "connected a GitHub installation",
  GITHUB_INSTALLATION_STATUS_CHANGED: "changed a GitHub installation",
  REPOSITORY_CONNECTED: "connected a repository",
  REPOSITORY_ACCESS_CHANGED: "changed repository access",
  REPOSITORY_IMPORT_COMPLETED: "imported repository evidence",
  BILLING_SUBSCRIPTION_UPDATED: "updated the subscription",
  BILLING_ENTITLEMENTS_UPDATED: "updated plan entitlements",
};

function hrefFor(
  base: string,
  targetType: ActivityTargetType,
  targetId: string,
): string | null {
  switch (targetType) {
    case "REQUIREMENT":
      return `${base}/requirements/${targetId}`;
    case "TEST_CASE":
      return `${base}/test-cases/${targetId}`;
    case "TEST_RUN":
      return `${base}/test-runs/${targetId}`;
    case "AUTOMATION_ARTIFACT":
      return `${base}/automation/${targetId}`;
    default:
      // Versions, attempts, findings and memberships have no page of their own.
      // A link that goes nowhere is worse than no link.
      return null;
  }
}

export async function listProjectActivity(
  input: { projectId: string; orgSlug?: string } & ListParams,
  dependencies?: WorkspaceContextDependencies,
) {
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId: input.projectId, permission: "project:read" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();
  const params = parseListParams(input);
  const where = {
    organizationId: workspace.organization.id,
    projectId: input.projectId,
  };
  const base = `/workspace/${workspace.organization.slug}/projects/${input.projectId}`;

  const [rows, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      include: { actor: { select: { displayName: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: params.skip,
      take: params.take,
    }),
    prisma.activity.count({ where }),
  ]);

  const entries: ActivityEntry[] = rows.map((row) => ({
    id: row.id,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    actorName: row.actor?.displayName ?? null,
    createdAt: row.createdAt,
    summary: actionSummary[row.action],
    href: hrefFor(base, row.targetType, row.targetId),
  }));

  return buildListResult(entries, total, params);
}

/**
 * Groups entries by calendar day.
 *
 * A flat list of timestamps makes a reader do the arithmetic of "was this today
 * or last week", which is the only question they came with.
 */
export function groupActivityByDay(
  entries: ActivityEntry[],
): Array<{ day: string; entries: ActivityEntry[] }> {
  const groups = new Map<string, ActivityEntry[]>();
  for (const entry of entries) {
    const day = entry.createdAt.toISOString().slice(0, 10);
    const bucket = groups.get(day);
    if (bucket) bucket.push(entry);
    else groups.set(day, [entry]);
  }
  return [...groups.entries()].map(([day, grouped]) => ({ day, entries: grouped }));
}
