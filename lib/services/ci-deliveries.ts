import "server-only";

import { z } from "zod";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { deliveryNote, type DeliveryCounts } from "@/lib/ci/delivery-note";
import { getPrismaClient } from "@/lib/db/prisma";

/**
 * The last time a customer's CI reached here, and what became of it.
 *
 * "Did my pipeline reach you?" had no answer in the product. A team whose token
 * was wrong and a team whose tests simply carry no marker saw the same thing --
 * an empty Test Runs tab -- and neither could tell which they were. The
 * delivery is recorded on the way in; this reads the most recent one back.
 */

export type CiDelivery = DeliveryCounts & {
  receivedAt: Date;
  /** Which CI sent it, as the pipeline named itself. */
  provider: string;
  runUrl: string | null;
  ref: string | null;
  commitSha: string | null;
  /** The same sentence the runner was given, so both say one thing. */
  note: string;
};

/** How each pipeline is written on the page. */
const PROVIDER_NAMES: Record<string, string> = {
  github_actions: "GitHub Actions",
  gitlab_ci: "GitLab CI",
  jenkins: "Jenkins",
  azure_pipelines: "Azure Pipelines",
  other: "CI",
};

export function providerName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? "CI";
}

const countFrom = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;

const textFrom = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

export async function readLastCiDelivery(
  input: { orgSlug?: string; projectId: string },
  dependencies?: WorkspaceContextDependencies,
): Promise<CiDelivery | null> {
  const projectId = z.string().uuid().parse(input.projectId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "project:read" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();

  const activity = await prisma.activity.findFirst({
    where: {
      organizationId: workspace.organization.id,
      projectId,
      action: "CI_RESULTS_DELIVERED",
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, metadata: true },
  });
  if (!activity) return null;

  // Read defensively: the row is history, and history outlives the shape that
  // wrote it. A delivery that is missing a field is still worth showing.
  const metadata = (activity.metadata ?? {}) as Record<string, unknown>;
  const counts: DeliveryCounts = {
    recorded: countFrom(metadata.recorded),
    duplicates: countFrom(metadata.duplicates),
    unmatched: countFrom(metadata.unmatched),
    total: countFrom(metadata.total),
  };

  return {
    ...counts,
    receivedAt: activity.createdAt,
    provider: textFrom(metadata.provider) ?? "other",
    runUrl: textFrom(metadata.url),
    ref: textFrom(metadata.ref),
    commitSha: textFrom(metadata.commitSha),
    note: deliveryNote(counts),
  };
}
