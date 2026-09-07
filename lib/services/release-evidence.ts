import "server-only";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { classifyRuns, loadAttemptFacts } from "@/lib/services/run-signals";

/**
 * The evidence behind a release, assembled per requirement.
 *
 * Every other view answers a question about one record. This answers the
 * question somebody actually has to sign their name to: for each thing we said
 * the product should do, what verifies it, when did that last run, and what
 * happened. Without it the answer lives in one person's memory of several
 * screens, which is precisely the thing an audit cannot accept and a release
 * meeting cannot check.
 *
 * The verdict per requirement is deliberately blunt and derived only from
 * stored records:
 *
 *   VERIFIED    an approved Test Case exists and its most recent attempt passed
 *   FAILING     an approved Test Case exists and its most recent attempt failed
 *   UNVERIFIED  nothing approved covers it, or nothing has ever run
 *
 * Drafts never count. A proposed or in-review Test Case describes coverage
 * somebody intends to have; treating it as coverage would let a requirement
 * read as verified because a test was written, not because it ran and passed.
 */

/** Bounded so a large project produces a report rather than a timeout. */
const REQUIREMENT_CAP = 500;

export type RequirementVerdict = "VERIFIED" | "FAILING" | "UNVERIFIED";

export type EvidenceTestCase = {
  id: string;
  title: string;
  status: string;
  versionNumber: number;
  latestResult: "PASSED" | "FAILED" | "BLOCKED" | "SKIPPED" | null;
  latestExecutedAt: Date | null;
  latestCommitSha: string | null;
  signal: string | null;
};

export type EvidenceRequirement = {
  id: string;
  title: string;
  status: string;
  versionNumber: number;
  externalReference: string | null;
  verdict: RequirementVerdict;
  /** Why the verdict is what it is, in one sentence a reader can check. */
  reason: string;
  testCases: EvidenceTestCase[];
};

export type ReleaseEvidenceReport = {
  project: { id: string; name: string; slug: string };
  organization: { name: string; slug: string };
  generatedAt: Date;
  requirements: EvidenceRequirement[];
  totals: { verified: number; failing: number; unverified: number };
  truncated: boolean;
};

export async function getReleaseEvidenceReport(
  input: { projectId: string; orgSlug?: string; now?: Date },
  dependencies?: WorkspaceContextDependencies,
): Promise<ReleaseEvidenceReport> {
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId: input.projectId, permission: "testrun:read" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();
  const organizationId = workspace.organization.id;
  const projectId = input.projectId;
  const now = input.now ?? new Date();

  const [project, requirements, attemptFacts] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { organizationId_id: { organizationId, id: projectId } },
      select: { id: true, name: true, slug: true },
    }),
    prisma.requirement.findMany({
      where: { organizationId, projectId, status: { not: "ARCHIVED" } },
      orderBy: [{ status: "asc" }, { title: "asc" }],
      take: REQUIREMENT_CAP + 1,
      select: {
        id: true,
        title: true,
        status: true,
        currentVersionNumber: true,
        externalReference: true,
        testCaseLinks: {
          select: {
            testCase: {
              select: {
                id: true,
                title: true,
                status: true,
                currentVersionNumber: true,
              },
            },
          },
        },
      },
    }),
    loadAttemptFacts(prisma, { organizationId, projectId }),
  ]);

  const signals = classifyRuns(attemptFacts);

  // The most recent attempt per Test Case, and the verdict of the run it
  // belongs to. Ordering by execution time rather than attempt number because
  // a Test Case can be exercised by more than one run.
  const latestByTestCase = new Map<string, (typeof attemptFacts)[number]>();
  for (const fact of attemptFacts) {
    const current = latestByTestCase.get(fact.testCaseId);
    if (!current || fact.executedAt > current.executedAt) {
      latestByTestCase.set(fact.testCaseId, fact);
    }
  }

  const evidence: EvidenceRequirement[] = requirements
    .slice(0, REQUIREMENT_CAP)
    .map((requirement) => {
      const testCases: EvidenceTestCase[] = requirement.testCaseLinks.map((link) => {
        const latest = latestByTestCase.get(link.testCase.id) ?? null;
        return {
          id: link.testCase.id,
          title: link.testCase.title,
          status: link.testCase.status,
          versionNumber: link.testCase.currentVersionNumber,
          latestResult: latest?.result ?? null,
          latestExecutedAt: latest?.executedAt ?? null,
          latestCommitSha: latest?.commitSha ?? null,
          signal: latest ? (signals.get(latest.testRunId)?.signal ?? null) : null,
        };
      });

      const approved = testCases.filter((testCase) => testCase.status === "APPROVED");
      const executed = approved.filter((testCase) => testCase.latestResult !== null);
      const failing = executed.filter((testCase) => testCase.latestResult !== "PASSED");
      const passing = executed.filter((testCase) => testCase.latestResult === "PASSED");

      let verdict: RequirementVerdict;
      let reason: string;
      if (failing.length > 0) {
        verdict = "FAILING";
        reason = `${failing.length} approved test${failing.length === 1 ? "" : "s"} last ran and did not pass.`;
      } else if (passing.length > 0) {
        verdict = "VERIFIED";
        reason = `${passing.length} approved test${passing.length === 1 ? "" : "s"} last ran and passed.`;
      } else if (approved.length > 0) {
        verdict = "UNVERIFIED";
        reason =
          "An approved test covers this, but it has never run, so nothing demonstrates the behaviour.";
      } else if (testCases.length > 0) {
        verdict = "UNVERIFIED";
        reason =
          "Every test covering this is still a draft. Intended coverage is not coverage until it is approved.";
      } else {
        verdict = "UNVERIFIED";
        reason = "Nothing is linked to this requirement, so nothing verifies it.";
      }

      return {
        id: requirement.id,
        title: requirement.title,
        status: requirement.status,
        versionNumber: requirement.currentVersionNumber,
        externalReference: requirement.externalReference,
        verdict,
        reason,
        testCases,
      };
    });

  return {
    project,
    organization: { name: workspace.organization.name, slug: workspace.organization.slug },
    generatedAt: now,
    requirements: evidence,
    totals: {
      verified: evidence.filter((item) => item.verdict === "VERIFIED").length,
      failing: evidence.filter((item) => item.verdict === "FAILING").length,
      unverified: evidence.filter((item) => item.verdict === "UNVERIFIED").length,
    },
    truncated: requirements.length > REQUIREMENT_CAP,
  };
}
