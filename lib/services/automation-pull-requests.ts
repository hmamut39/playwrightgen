import "server-only";

import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { slugify } from "@/lib/format/slug";
import { GitHubProviderError } from "@/lib/integrations/github/app-client";
import { openPullRequest, type AutomationPullRequest } from "@/lib/integrations/github/pull-request";
import { siteUrl } from "@/lib/site";

/**
 * Approved automation, offered to the connected repository as a pull request.
 *
 * Until now reviewed code left PlaywrightGen by copy and paste, which loses the
 * link between the file in the repository and the approved version it came
 * from. A pull request keeps both: the branch and file carry the version
 * marker, and the description links back to the record here, so the repository
 * review and the PlaywrightGen approval describe the same thing.
 *
 * Only approved automation is offered, only into a repository the team already
 * connected, and only by someone who may approve in this project. PlaywrightGen
 * opens the pull request and stops; merging stays with the repository's own
 * review.
 */

export class AutomationPullRequestError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "not_approved"
      | "no_repository"
      | "permission_missing"
      | "provider_failed",
    readonly detail?: string,
  ) {
    super(code);
    this.name = "AutomationPullRequestError";
  }
}

type Dependencies = WorkspaceContextDependencies & { prisma?: PrismaClient };

function client(dependencies?: Dependencies) {
  return dependencies?.prisma ?? getPrismaClient();
}

/** Where the test lands, and the branch it lands on. */
export function pullRequestPaths(input: { name: string; versionNumber: number }) {
  const slug = slugify(input.name).slice(0, 60) || "playwrightgen-test";
  return {
    path: `tests/playwrightgen/${slug}.spec.ts`,
    branch: `playwrightgen/${slug}-v${input.versionNumber}`,
  };
}

/** What the reviewer in the repository reads before merging. */
export function pullRequestBody(input: {
  testCaseTitle: string;
  versionNumber: number;
  testCaseVersionNumber: number;
  summary: string;
  approvedBy: string | null;
  link: string;
}) {
  return [
    `Approved Playwright automation from PlaywrightGen for **${input.testCaseTitle}**.`,
    "",
    `- Automation version ${input.versionNumber}, pinned to Test Case version ${input.testCaseVersionNumber}.`,
    input.approvedBy ? `- Approved in PlaywrightGen by ${input.approvedBy}.` : null,
    input.summary ? `- ${input.summary}` : null,
    `- Record: ${input.link}`,
    "",
    "The test title carries a `[pwg:…]` marker. Keep it: it is how a CI result attaches back to the approved version.",
    "",
    "PlaywrightGen opened this pull request and cannot merge it.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export async function openAutomationPullRequest(
  input: { orgSlug?: string; projectId: string; automationArtifactId: string },
  dependencies?: Dependencies,
  opener: typeof openPullRequest = openPullRequest,
): Promise<AutomationPullRequest & { repository: string }> {
  const projectId = z.string().uuid().parse(input.projectId);
  const automationArtifactId = z.string().uuid().parse(input.automationArtifactId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "repository:pull_request" },
    dependencies,
  );
  const prisma = client(dependencies);
  const organizationId = workspace.organization.id;

  const artifact = await prisma.automationArtifact.findUnique({
    where: { organizationId_projectId_id: { organizationId, projectId, id: automationArtifactId } },
    include: {
      versions: { orderBy: { versionNumber: "desc" } },
      testCase: { select: { id: true, title: true } },
      testCaseVersion: { select: { versionNumber: true } },
      approvedBy: { select: { displayName: true } },
    },
  });
  if (!artifact) throw new AutomationPullRequestError("not_found");
  if (artifact.status !== "APPROVED" || artifact.approvedVersionNumber === null) {
    throw new AutomationPullRequestError("not_approved");
  }
  const version = artifact.versions.find((entry) => entry.versionNumber === artifact.approvedVersionNumber);
  if (!version?.code) throw new AutomationPullRequestError("not_approved");

  const connection = await prisma.repositoryConnection.findFirst({
    where: { organizationId, projectId, status: "ACTIVE", installation: { status: "ACTIVE" } },
    orderBy: { updatedAt: "desc" },
    include: { installation: { select: { externalInstallationId: true } } },
  });
  if (!connection) throw new AutomationPullRequestError("no_repository");

  const { path, branch } = pullRequestPaths({ name: artifact.name, versionNumber: artifact.approvedVersionNumber });
  const title = `Add approved Playwright test: ${artifact.testCase.title}`.slice(0, 200);
  const body = pullRequestBody({
    testCaseTitle: artifact.testCase.title,
    versionNumber: artifact.approvedVersionNumber,
    testCaseVersionNumber: artifact.testCaseVersion.versionNumber,
    summary: version.summary ?? "",
    approvedBy: artifact.approvedBy?.displayName ?? null,
    link: `${siteUrl()}/workspace/${workspace.organization.slug}/projects/${projectId}/automation/${automationArtifactId}`,
  });

  let pullRequest: AutomationPullRequest;
  try {
    pullRequest = await opener({
      installationId: connection.installation.externalInstallationId,
      externalRepositoryId: connection.externalRepositoryId,
      owner: connection.ownerLogin,
      repo: connection.name,
      baseBranch: connection.defaultBranch,
      branch,
      title,
      body,
      files: [{ path, content: version.code.endsWith("\n") ? version.code : `${version.code}\n` }],
    });
  } catch (error) {
    if (error instanceof GitHubProviderError && error.code === "github_pull_request_permission_missing") {
      throw new AutomationPullRequestError(
        "permission_missing",
        "The GitHub App may only read this repository. A repository admin must allow Contents and Pull requests write, then accept the update on the installation.",
      );
    }
    console.error("[automation-pull-request] provider failed", error);
    throw new AutomationPullRequestError("provider_failed");
  }

  await prisma.activity.create({
    data: {
      organizationId,
      projectId,
      actorUserId: workspace.user.id,
      source: "USER",
      action: "AUTOMATION_PULL_REQUEST_OPENED",
      targetType: "AUTOMATION_ARTIFACT",
      targetId: automationArtifactId,
      metadata: {
        repository: connection.fullName,
        pullRequestNumber: pullRequest.number,
        pullRequestUrl: pullRequest.url,
        branch: pullRequest.branch,
        versionNumber: artifact.approvedVersionNumber,
        alreadyOpen: !pullRequest.created,
      },
    },
  });

  return { ...pullRequest, repository: connection.fullName };
}

/** Whether this project has a repository a pull request could go to. */
export async function hasConnectedRepository(
  input: { orgSlug?: string; projectId: string },
  dependencies?: Dependencies,
) {
  const projectId = z.string().uuid().parse(input.projectId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "repository:read" },
    dependencies,
  );
  const count = await client(dependencies).repositoryConnection.count({
    where: {
      organizationId: workspace.organization.id,
      projectId,
      status: "ACTIVE",
      installation: { status: "ACTIVE" },
    },
  });
  return count > 0;
}
