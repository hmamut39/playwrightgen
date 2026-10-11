import "server-only";

import { z } from "zod";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import {
  listMilestoneReferences,
  listMilestones,
  type GitHubMilestone,
} from "@/lib/integrations/github/milestones";
import type { ReleaseEvidenceReport } from "@/lib/services/release-evidence";

/**
 * Narrowing the evidence to the thing a team is actually shipping.
 *
 * "What is the evidence for this release" is the question a product owner
 * arrives with, and the whole report cannot answer it: a project holds every
 * requirement it has ever had, and a release is a handful of them.
 *
 * It is answered without a release entity. A sprint or a milestone is a
 * time-box that lives in the tracker, where the team edits it daily; a copy
 * here would disagree with it inside a week and would need a page to disagree
 * on. Instead the grouping is read from the tracker, and the join is the
 * reference a requirement already carries from the ticket it was drafted
 * from -- which the GitHub ticket fetch fills in automatically.
 *
 * The cost of that choice is stated rather than hidden: a requirement written
 * by hand, with no reference, belongs to no milestone and is counted as
 * unassigned, because silently dropping it would make a release look smaller
 * and better verified than it is.
 */

export type ReleaseScope = {
  milestone: GitHubMilestone;
  /** Requirements in this milestone, in the report's own order. */
  requirements: ReleaseEvidenceReport["requirements"];
  totals: ReleaseEvidenceReport["totals"];
  /** Issues in the milestone that no requirement here references. */
  withoutRequirement: number;
};

export class ReleaseScopeError extends Error {
  constructor(readonly code: "no_repository" | "unavailable") {
    super(code);
    this.name = "ReleaseScopeError";
  }
}

type Dependencies = WorkspaceContextDependencies & {
  readMilestones?: typeof listMilestones;
  readReferences?: typeof listMilestoneReferences;
};

async function connectionFor(
  input: { orgSlug?: string; projectId: string },
  dependencies?: Dependencies,
) {
  const projectId = z.string().uuid().parse(input.projectId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "project:read" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();

  const connection = await prisma.repositoryConnection.findFirst({
    where: { organizationId: workspace.organization.id, projectId, status: "ACTIVE" },
    select: {
      externalRepositoryId: true,
      ownerLogin: true,
      name: true,
      installation: { select: { externalInstallationId: true } },
    },
  });
  if (!connection?.installation) throw new ReleaseScopeError("no_repository");

  return {
    installationId: connection.installation.externalInstallationId,
    externalRepositoryId: connection.externalRepositoryId,
    ownerLogin: connection.ownerLogin,
    repositoryName: connection.name,
  };
}

/** The milestones a team could scope a release to. Empty is an ordinary answer. */
export async function listReleaseMilestones(
  input: { orgSlug?: string; projectId: string },
  dependencies?: Dependencies,
): Promise<GitHubMilestone[]> {
  const repository = await connectionFor(input, dependencies);
  try {
    return await (dependencies?.readMilestones ?? listMilestones)(repository);
  } catch {
    throw new ReleaseScopeError("unavailable");
  }
}

/**
 * The evidence for one milestone, taken from a report already built.
 *
 * The report is passed in rather than rebuilt so the page shows one reading of
 * the project, scoped two ways, instead of two readings taken moments apart
 * that could disagree about a run recorded in between.
 */
export async function scopeReleaseToMilestone(
  input: { orgSlug?: string; projectId: string; milestoneNumber: number },
  report: ReleaseEvidenceReport,
  dependencies?: Dependencies,
): Promise<ReleaseScope> {
  const repository = await connectionFor(input, dependencies);

  let milestones: GitHubMilestone[];
  let references: string[];
  try {
    const read = dependencies?.readMilestones ?? listMilestones;
    const readRefs = dependencies?.readReferences ?? listMilestoneReferences;
    [milestones, references] = await Promise.all([
      read(repository),
      readRefs({ ...repository, milestoneNumber: input.milestoneNumber }),
    ]);
  } catch {
    throw new ReleaseScopeError("unavailable");
  }

  const milestone = milestones.find((entry) => entry.number === input.milestoneNumber);
  if (!milestone) throw new ReleaseScopeError("unavailable");

  // GitHub treats owner and repository names as case-insensitive, and a
  // reference typed by hand will not always match the casing the fetch wrote.
  const wanted = new Set(references.map((reference) => reference.toLowerCase()));
  const matched = new Set<string>();
  const requirements = report.requirements.filter((requirement) => {
    const reference = requirement.externalReference?.trim().toLowerCase();
    if (!reference || !wanted.has(reference)) return false;
    matched.add(reference);
    return true;
  });

  return {
    milestone,
    requirements,
    totals: {
      verified: requirements.filter((item) => item.verdict === "VERIFIED").length,
      failing: requirements.filter((item) => item.verdict === "FAILING").length,
      unverified: requirements.filter((item) => item.verdict === "UNVERIFIED").length,
      stale: requirements.filter(
        (item) => item.verdict === "VERIFIED" && item.freshness === "STALE",
      ).length,
    },
    // An issue in the milestone that nothing here references is work with no
    // requirement behind it, which is exactly what a release review is for.
    withoutRequirement: wanted.size - matched.size,
  };
}
