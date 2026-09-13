import "server-only";

import type { ActivityAction } from "@/generated/prisma/client";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { countOtherApprovers } from "@/lib/services/approval-policy";

/**
 * Everything in a project waiting for someone to approve it.
 *
 * Submitting for review used to be a message into nothing: the record changed
 * colour and waited until somebody happened to open it. A lead had no way to
 * see what was waiting on them without opening every requirement, test case
 * and automation in turn, so the review step -- the one that turns drafts into
 * evidence -- was the slowest step for no reason but visibility.
 *
 * Oldest first, because the longest wait is the one to clear, and split by
 * whose move it is: the reader's, or someone else's.
 */

export type ReviewKind = "requirement" | "testCase" | "automation";

export type ReviewItem = {
  kind: ReviewKind;
  id: string;
  title: string;
  href: string;
  submittedAt: Date | null;
  submittedBy: string | null;
  /** Whole days since submission; 0 means today. */
  waitingDays: number | null;
  /** The reader may approve this now. */
  yours: boolean;
  /** Why it is not the reader's move, when it is not. */
  reason: "own_submission" | "not_an_approver" | null;
};

const SUBMITTED_ACTIONS: Record<ReviewKind, ActivityAction> = {
  requirement: "REQUIREMENT_SUBMITTED_FOR_REVIEW",
  testCase: "TEST_CASE_SUBMITTED_FOR_REVIEW",
  automation: "AUTOMATION_SUBMITTED_FOR_REVIEW",
};

const LIMIT = 100;

export async function getReviewQueue(
  input: { orgSlug?: string; projectId: string; now?: Date },
  dependencies?: WorkspaceContextDependencies,
) {
  const now = (input.now ?? new Date()).getTime();
  const context = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId: input.projectId, permission: "requirement:read" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();
  const organizationId = context.organization.id;
  const projectId = context.project!.id;
  const base = `/workspace/${context.organization.slug}/projects/${projectId}`;
  const scope = { organizationId, projectId, status: "IN_REVIEW" as const };

  const [requirements, testCases, automation, otherApprovers] = await Promise.all([
    prisma.requirement.findMany({
      where: scope,
      select: { id: true, title: true, submittedForReviewAt: true },
      orderBy: [{ submittedForReviewAt: "asc" }, { id: "asc" }],
      take: LIMIT,
    }),
    prisma.testCase.findMany({
      where: scope,
      select: { id: true, title: true, submittedForReviewAt: true },
      orderBy: [{ submittedForReviewAt: "asc" }, { id: "asc" }],
      take: LIMIT,
    }),
    prisma.automationArtifact.findMany({
      where: scope,
      select: { id: true, name: true, submittedForReviewAt: true },
      orderBy: [{ submittedForReviewAt: "asc" }, { id: "asc" }],
      take: LIMIT,
    }),
    countOtherApprovers(prisma, { organizationId, projectId, approverUserId: context.user.id }),
  ]);

  const targetIds = [...requirements, ...testCases, ...automation].map((record) => record.id);
  const submissions = targetIds.length
    ? await prisma.activity.findMany({
        where: {
          organizationId,
          projectId,
          targetId: { in: targetIds },
          action: { in: Object.values(SUBMITTED_ACTIONS) },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: {
          targetId: true,
          actorUserId: true,
          actor: { select: { displayName: true } },
        },
      })
    : [];
  // Newest first, so the first one seen per record is its latest submission.
  const submitter = new Map<string, { userId: string | null; name: string | null }>();
  for (const submission of submissions) {
    if (!submitter.has(submission.targetId)) {
      submitter.set(submission.targetId, {
        userId: submission.actorUserId,
        name: submission.actor?.displayName ?? null,
      });
    }
  }

  const canApprove: Record<ReviewKind, boolean> = {
    requirement: context.can("requirement:approve"),
    testCase: context.can("testcase:approve"),
    automation: context.can("automation:approve"),
  };

  function item(
    kind: ReviewKind,
    record: { id: string; submittedForReviewAt: Date | null },
    title: string,
    href: string,
  ): ReviewItem {
    const by = submitter.get(record.id);
    const ownSubmission = by?.userId === context.user.id;
    const reason = !canApprove[kind]
      ? "not_an_approver"
      : ownSubmission && otherApprovers > 0
        ? "own_submission"
        : null;
    return {
      kind,
      id: record.id,
      title,
      href,
      submittedAt: record.submittedForReviewAt,
      submittedBy: by?.name ?? null,
      waitingDays: record.submittedForReviewAt
        ? Math.max(0, Math.floor((now - record.submittedForReviewAt.getTime()) / 86_400_000))
        : null,
      yours: reason === null,
      reason,
    };
  }

  const items = [
    ...requirements.map((record) =>
      item("requirement", record, record.title, `${base}/requirements/${record.id}`),
    ),
    ...testCases.map((record) =>
      item("testCase", record, record.title, `${base}/test-cases/${record.id}`),
    ),
    ...automation.map((record) =>
      item("automation", record, record.name, `${base}/automation/${record.id}`),
    ),
  ].sort(
    (left, right) =>
      (left.submittedAt?.getTime() ?? 0) - (right.submittedAt?.getTime() ?? 0),
  );

  return {
    yours: items.filter((entry) => entry.yours),
    others: items.filter((entry) => !entry.yours),
  };
}

/**
 * How many records wait for review in each project of an organization, for the
 * project cards people see first when they sign in.
 */
export async function getOrganizationReviewCounts(
  input: { orgSlug?: string },
  dependencies?: WorkspaceContextDependencies,
): Promise<Map<string, number>> {
  const context = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, permission: "organization:read" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();
  const where = { organizationId: context.organization.id, status: "IN_REVIEW" as const };
  const groups = await Promise.all([
    prisma.requirement.groupBy({ by: ["projectId"], where, _count: { _all: true } }),
    prisma.testCase.groupBy({ by: ["projectId"], where, _count: { _all: true } }),
    prisma.automationArtifact.groupBy({ by: ["projectId"], where, _count: { _all: true } }),
  ]);
  const counts = new Map<string, number>();
  for (const group of groups.flat()) {
    counts.set(group.projectId, (counts.get(group.projectId) ?? 0) + group._count._all);
  }
  return counts;
}
