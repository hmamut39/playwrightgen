import "server-only";

import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import {
  readOrganizationAiAllowance,
  type AiSurfaceSpend,
} from "@/lib/operations/organization-ai-guard";

/**
 * Where today's AI requests went, for somebody who has just been refused one.
 *
 * Read only when the refusal is the daily allowance, which is the only case
 * where the question arises: a burst limit clears in a minute and nobody
 * wonders what used it. Every other render of the page costs nothing, which
 * is why this is a function and not another field on the page's data.
 *
 * Never throws. The notice beside it says the thing that matters -- the
 * allowance is spent and when it returns -- and a breakdown that cannot be
 * read must not take that away.
 */
export async function spendBehindNotice(
  notice: string | undefined,
  // Either is accepted so a page that already holds its workspace does not
  // fetch it twice, and a page that does not hold it stays a single line.
  where: { organizationId: string } | { orgSlug: string; projectId: string },
): Promise<AiSurfaceSpend[]> {
  if (!notice?.startsWith("ai-daily")) return [];
  try {
    const organizationId =
      "organizationId" in where
        ? where.organizationId
        : (await requireWorkspaceContext({ orgSlug: where.orgSlug, projectId: where.projectId })).organization.id;
    const allowance = await readOrganizationAiAllowance({ organizationId });
    return allowance.bySurface;
  } catch (error) {
    console.error("[ai-spend] today's breakdown could not be read", error);
    return [];
  }
}
