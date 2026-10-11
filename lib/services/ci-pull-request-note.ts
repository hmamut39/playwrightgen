import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { deliveryNote, type DeliveryCounts } from "@/lib/ci/delivery-note";
import { getPrismaClient } from "@/lib/db/prisma";
import { leavePullRequestNote, NOTE_MARKER } from "@/lib/integrations/github/pull-request-note";
import { buildReleaseEvidenceReport } from "@/lib/services/release-evidence";
import { siteUrl } from "@/lib/site";

/**
 * Telling the pull request what its own change did to the evidence.
 *
 * A developer whose push broke a test never opens PlaywrightGen. Their work
 * happens in a pull request, and that is where the decision to merge is made.
 * CI already tells them which tests failed; repeating that would be noise.
 *
 * The sentence only this product can write is the one about requirements: that
 * the test which just started failing is the only thing verifying "a customer
 * can pay with a saved card", and that the requirement is now unverified. That
 * fact is assembled from the approval chain, the version pinning and the run
 * evidence, and no other tool in the pipeline holds all three.
 *
 * It states and never gates. A merge is a decision a person makes, and a
 * product that refuses to let somebody ship has started claiming an authority
 * it spent its whole design avoiding.
 */

const VERDICT_WORD = {
  VERIFIED: "verified",
  FAILING: "failing",
  UNVERIFIED: "not verified",
} as const;

export type DeliveryForNote = {
  organizationId: string;
  projectId: string;
  /** The branch the results came from, which is how the pull request is found. */
  ref: string;
  commitSha: string;
  provider: string;
  counts: DeliveryCounts;
  recordedTestCaseIds: string[];
};

const PROVIDER_NAMES: Record<string, string> = {
  github_actions: "GitHub Actions",
  gitlab_ci: "GitLab CI",
  jenkins: "Jenkins",
  azure_pipelines: "Azure Pipelines",
  other: "CI",
};

/**
 * Builds the comment. Separated from posting it so the wording can be read in
 * a test without a network, which is most of what is worth checking here.
 */
export function pullRequestNoteBody(input: {
  delivery: DeliveryForNote;
  /** Requirements linked to the Test Cases this delivery recorded. */
  touched: Array<{ title: string; verdict: keyof typeof VERDICT_WORD; reason: string }>;
  projectUrl: string;
}): string {
  const { delivery, touched } = input;
  const provider = PROVIDER_NAMES[delivery.provider] ?? "CI";
  const lines: string[] = [NOTE_MARKER, "### PlaywrightGen"];

  lines.push(
    `${provider} reported ${delivery.counts.total} result${delivery.counts.total === 1 ? "" : "s"} for \`${delivery.commitSha.slice(0, 8)}\`. ${deliveryNote(delivery.counts)}`,
  );

  const losing = touched.filter((item) => item.verdict !== "VERIFIED");
  const holding = touched.filter((item) => item.verdict === "VERIFIED");

  if (losing.length > 0) {
    lines.push(
      "",
      `**${losing.length} requirement${losing.length === 1 ? "" : "s"} this change touches ${losing.length === 1 ? "is" : "are"} not verified**`,
    );
    // The requirement, not the test. A test name tells a developer what broke;
    // the requirement tells them what is no longer true of the product.
    for (const item of losing) {
      lines.push(`- ${item.title} — _${VERDICT_WORD[item.verdict]}._ ${item.reason}`);
    }
  }

  if (holding.length > 0) {
    lines.push(
      "",
      `**${holding.length} still verified**`,
      ...holding.map((item) => `- ${item.title}`),
    );
  }

  if (touched.length === 0 && delivery.counts.recorded > 0) {
    lines.push("", "None of the tests recorded here are linked to a requirement yet.");
  }

  lines.push(
    "",
    `[See the evidence](${input.projectUrl}) · This is a statement of what was recorded, not a gate. Merging is your decision.`,
  );

  return lines.join("\n");
}

/**
 * Reads what this delivery did to the project's requirements, then leaves it
 * on the pull request.
 *
 * Never throws at the caller. It runs after a webhook has already answered,
 * and a repository that has not granted the App comment access, or a branch
 * with no open pull request, is an ordinary outcome rather than a failure of
 * the ingest that triggered it.
 */
export async function notePullRequest(
  delivery: DeliveryForNote,
  dependencies?: {
    prisma?: PrismaClient;
    leaveNote?: typeof leavePullRequestNote;
  },
): Promise<{ posted: number[]; skipped?: string }> {
  const prisma = dependencies?.prisma ?? getPrismaClient();

  if (delivery.recordedTestCaseIds.length === 0) {
    return { posted: [], skipped: "nothing recorded" };
  }

  const connection = await prisma.repositoryConnection.findFirst({
    where: {
      organizationId: delivery.organizationId,
      projectId: delivery.projectId,
      status: "ACTIVE",
    },
    select: {
      externalRepositoryId: true,
      ownerLogin: true,
      name: true,
      installation: { select: { externalInstallationId: true } },
    },
  });
  if (!connection?.installation) return { posted: [], skipped: "no active connection" };

  const report = await buildReleaseEvidenceReport({
    organizationId: delivery.organizationId,
    projectId: delivery.projectId,
    prisma,
  }).catch(() => null);
  if (!report) return { posted: [], skipped: "no evidence report" };

  const recorded = new Set(delivery.recordedTestCaseIds);
  const touched = report.requirements
    .filter((requirement) => requirement.testCases.some((test) => recorded.has(test.id)))
    .map((requirement) => ({
      title: requirement.title,
      verdict: requirement.verdict,
      reason: requirement.reason,
    }));

  const projectUrl = `${siteUrl()}/workspace/${report.organization.slug}/projects/${report.project.id}/release`;

  try {
    const note = await (dependencies?.leaveNote ?? leavePullRequestNote)({
      installationId: connection.installation.externalInstallationId,
      externalRepositoryId: connection.externalRepositoryId,
      ownerLogin: connection.ownerLogin,
      repositoryName: connection.name,
      branch: delivery.ref,
      body: pullRequestNoteBody({ delivery, touched, projectUrl }),
    });
    return { posted: note.pullNumbers };
  } catch (error) {
    // The evidence is already recorded; leaving a comment is the part that may
    // not be permitted, and it must never look like the ingest failed.
    return {
      posted: [],
      skipped: error instanceof Error ? error.message : "could not comment",
    };
  }
}
