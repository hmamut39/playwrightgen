import "server-only";

import type { ActivityAction, ActivityTargetType, Prisma } from "@/generated/prisma/client";

/**
 * Whether someone may approve the thing in front of them.
 *
 * Approval is what turns a draft into evidence other people rely on, so it has
 * to mean that a second person looked. Project leads can now approve as well as
 * author, which is how QA teams actually divide the work -- engineers write,
 * leads decide -- and without this rule a lead could submit their own test case
 * and approve it a moment later, which is a signature with nobody behind it.
 *
 * The rule never locks anyone out. A solo founder, or a workspace where the
 * submitter is the only person able to approve, may still approve their own
 * work: refusing would leave it unapprovable forever, and a record that can
 * never be approved protects nothing. The moment a second person could approve
 * it, they have to. That makes separation of duties arrive with the team rather
 * than being a setting somebody has to know to turn on.
 *
 * Who submitted is read from the audit trail rather than a column, because the
 * trail already records every submission with its actor and cannot be edited.
 */

export type SelfApprovalDecision =
  | { allowed: true; reason: "different_person" | "not_submitted" | "sole_approver" }
  | { allowed: false; reason: "another_approver_exists" };

export async function checkSelfApproval(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    projectId: string;
    targetType: ActivityTargetType;
    targetId: string;
    submittedAction: ActivityAction;
    approverUserId: string;
  },
): Promise<SelfApprovalDecision> {
  const submission = await transaction.activity.findFirst({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.submittedAction,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { actorUserId: true },
  });

  if (!submission?.actorUserId) {
    return { allowed: true, reason: "not_submitted" };
  }
  if (submission.actorUserId !== input.approverUserId) {
    return { allowed: true, reason: "different_person" };
  }

  const others = await countOtherApprovers(transaction, input);
  return others > 0
    ? { allowed: false, reason: "another_approver_exists" }
    : { allowed: true, reason: "sole_approver" };
}

/**
 * Anyone else who could approve: an active organization owner or admin, or an
 * active lead of this project. Disabled accounts and removed memberships are
 * excluded -- a colleague who has left cannot be the reason a record stays
 * unapproved.
 */
export async function countOtherApprovers(
  transaction: Prisma.TransactionClient,
  input: { organizationId: string; projectId: string; approverUserId: string },
) {
  const [organizationApprovers, projectLeads] = await Promise.all([
    transaction.membership.count({
      where: {
        organizationId: input.organizationId,
        userId: { not: input.approverUserId },
        role: { in: ["OWNER", "ADMIN"] },
        status: "ACTIVE",
        user: { status: "ACTIVE" },
      },
    }),
    transaction.projectMembership.count({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: { not: input.approverUserId },
        role: "PROJECT_LEAD",
        status: "ACTIVE",
        // A project role only counts while the organization membership behind
        // it is also active.
        membership: { status: "ACTIVE", user: { status: "ACTIVE" } },
      },
    }),
  ]);
  return organizationApprovers + projectLeads;
}

export type ReviewTrail = {
  submitted: { by: string | null; at: Date } | null;
  decision: {
    kind: "approved" | "changes_requested";
    by: string | null;
    at: Date;
  } | null;
  /** The viewer submitted this and somebody else is able to approve it. */
  awaitingAnotherApprover: boolean;
  /** Who can, when the viewer cannot: "waiting for someone" names them. */
  otherApprovers: string[];
};

/**
 * Who sent a record for review and who decided on it, read from the audit trail.
 *
 * A status badge says "Approved" and nothing about by whom, which is the one
 * thing an auditor -- or a lead deciding whether to trust it -- actually asks.
 * Only the latest round counts: a decision older than the latest submission
 * belongs to a version that has since been reworked.
 */
export async function describeReviewTrail(
  reader: Prisma.TransactionClient,
  input: {
    organizationId: string;
    projectId: string;
    targetType: ActivityTargetType;
    targetId: string;
    actions: {
      submitted: ActivityAction;
      approved: ActivityAction;
      changesRequested: ActivityAction;
    };
    viewerUserId: string;
    /** Only an in-review record can be waiting on an approver. */
    inReview: boolean;
  },
): Promise<ReviewTrail> {
  /*
   * The latest submission, asked for directly rather than found in a window.
   *
   * This read the twenty newest events for the record and looked for a
   * submission among them. Twenty is almost always plenty -- and when it is
   * not, the page stops believing the record was ever submitted, drops the
   * line saying who submitted it, and offers an Approve button to the person
   * who submitted it. The rule itself holds: `checkSelfApproval` asks for the
   * submission directly and refuses the click. But a page that offers
   * something the product then refuses has told somebody a lie about what
   * they may do, and the fix is to read the same fact the rule reads.
   */
  const submission = await reader.activity.findFirst({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.actions.submitted,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true, actorUserId: true, actor: { select: { displayName: true } } },
  });

  // The decision that followed it, which is the only one that still describes
  // this version: anything older belongs to a round that has been superseded.
  const decisionEvent = await reader.activity.findFirst({
    where: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      targetType: input.targetType,
      targetId: input.targetId,
      action: { in: [input.actions.approved, input.actions.changesRequested] },
      ...(submission ? { createdAt: { gte: submission.createdAt } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { action: true, createdAt: true, actor: { select: { displayName: true } } },
  });

  let awaitingAnotherApprover = false;
  let otherApprovers: string[] = [];
  if (input.inReview && submission?.actorUserId === input.viewerUserId) {
    otherApprovers = await listOtherApproverNames(reader, {
      organizationId: input.organizationId,
      projectId: input.projectId,
      approverUserId: input.viewerUserId,
    });
    awaitingAnotherApprover = otherApprovers.length > 0;
  }

  return {
    submitted: submission
      ? { by: submission.actor?.displayName ?? null, at: submission.createdAt }
      : null,
    decision: decisionEvent
      ? {
          kind:
            decisionEvent.action === input.actions.approved
              ? "approved"
              : "changes_requested",
          by: decisionEvent.actor?.displayName ?? null,
          at: decisionEvent.createdAt,
        }
      : null,
    awaitingAnotherApprover,
    otherApprovers,
  };
}

/** Names of up to three other people who could approve, leads first. */
async function listOtherApproverNames(
  reader: Prisma.TransactionClient,
  input: { organizationId: string; projectId: string; approverUserId: string },
): Promise<string[]> {
  const [leads, admins] = await Promise.all([
    reader.projectMembership.findMany({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: { not: input.approverUserId },
        role: "PROJECT_LEAD",
        status: "ACTIVE",
        membership: { status: "ACTIVE", user: { status: "ACTIVE" } },
      },
      select: { membership: { select: { user: { select: { displayName: true } } } } },
      take: 3,
    }),
    reader.membership.findMany({
      where: {
        organizationId: input.organizationId,
        userId: { not: input.approverUserId },
        role: { in: ["OWNER", "ADMIN"] },
        status: "ACTIVE",
        user: { status: "ACTIVE" },
      },
      select: { user: { select: { displayName: true } } },
      take: 3,
    }),
  ]);
  const names = [
    ...leads.map((row) => row.membership.user.displayName),
    ...admins.map((row) => row.user.displayName),
  ].map((name) => name?.trim() || "a workspace member");
  return [...new Set(names)].slice(0, 3);
}
