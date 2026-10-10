import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import type { RejectionReason } from "@/lib/ci/delivery-note";
import { getPrismaClient } from "@/lib/db/prisma";

/**
 * Recording a delivery that arrived and was turned away.
 *
 * Accepted deliveries are visible now, which left the commoner failure dark: a
 * project token is rotated here, the pipeline keeps sending the old one, every
 * request is refused, and the page says no results have arrived. That reads as
 * "your CI never ran" when the truth is "your CI is being turned away at the
 * door".
 *
 * Only a refusal the product can attribute is written. The caller must have
 * proved possession of a real token for this project -- the current one, or one
 * of the recent previous versions -- before anything reaches this function, so
 * an unauthenticated caller can neither fill the table nor learn which projects
 * exist by watching what happens. Nothing here is evidence about a test: a
 * rejected delivery recorded nothing and the row says only that it came and was
 * refused.
 */

export type CiRejection = {
  organizationId: string;
  projectId: string;
  reason: RejectionReason;
  provider: string;
  ref: string;
  commitSha: string;
  externalId: string;
  url: string;
  /** How many results the refused delivery was carrying. */
  total: number;
};

export async function recordCiRejection(
  rejection: CiRejection,
  dependencies?: { prisma?: PrismaClient },
): Promise<void> {
  const prisma = dependencies?.prisma ?? getPrismaClient();

  await prisma.activity.create({
    data: {
      organizationId: rejection.organizationId,
      projectId: rejection.projectId,
      // Nobody performed this. A refused delivery proves possession of a token,
      // which is not the same as knowing which person is behind it, and naming
      // one would put a guess into an append-only record.
      actorUserId: null,
      source: "SYSTEM",
      action: "CI_RESULTS_REJECTED",
      targetType: "PROJECT",
      targetId: rejection.projectId,
      metadata: {
        reason: rejection.reason,
        provider: rejection.provider,
        externalId: rejection.externalId,
        url: rejection.url,
        ref: rejection.ref,
        commitSha: rejection.commitSha,
        total: rejection.total,
      },
    },
  });
}
