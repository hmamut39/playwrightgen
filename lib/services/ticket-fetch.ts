import "server-only";

import { z } from "zod";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { fetchGitHubIssue, GitHubIssueError } from "@/lib/integrations/github/issue";

/**
 * Turning the address of a ticket into the text of one.
 *
 * Drafting a requirement from a ticket already worked, as long as somebody
 * pasted it; this removes the pasting. What it returns is the same thing the
 * paste box produced, so everything downstream is unchanged: the same reading,
 * the same refusal when a ticket is not about behaviour, the same open
 * questions kept out of the description.
 *
 * Only a repository this project has actively connected may be read. The App
 * may be installed on an account's other repositories, and without this check
 * a member of one project could use PlaywrightGen to read issues out of any of
 * them. The connection is the permission, and it is looked up scoped to the
 * organization and the project like every other tenant-sensitive read.
 */

export class TicketFetchError extends Error {
  constructor(
    readonly code:
      | "not_a_github_issue"
      | "repository_not_connected"
      | "issue_not_found"
      | "issue_is_a_pull_request"
      | "issue_permission_missing"
      | "github_unavailable",
  ) {
    super(code);
    this.name = "TicketFetchError";
  }
}

export type FetchedTicket = {
  /** Title and body as one block, which is what the reader expects. */
  ticket: string;
  url: string;
  reference: string;
};

/** `https://github.com/owner/repo/issues/123`, with or without decoration. */
export function parseGitHubIssueUrl(
  value: string,
): { owner: string; repository: string; number: number } | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  // github.com only. An enterprise host would need its own App and its own
  // decision, and guessing one is worse than declining.
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[2] !== "issues") return null;
  const number = Number(parts[3]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;

  return { owner: parts[0], repository: parts[1], number };
}

export async function fetchTicketFromGitHub(
  input: { orgSlug?: string; projectId: string; url: string },
  dependencies?: WorkspaceContextDependencies & {
    fetchIssue?: typeof fetchGitHubIssue;
  },
): Promise<FetchedTicket> {
  const projectId = z.string().uuid().parse(input.projectId);
  const parsed = parseGitHubIssueUrl(input.url);
  if (!parsed) throw new TicketFetchError("not_a_github_issue");

  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "requirement:create" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();

  const connection = await prisma.repositoryConnection.findFirst({
    where: {
      organizationId: workspace.organization.id,
      projectId,
      status: "ACTIVE",
      ownerLogin: { equals: parsed.owner, mode: "insensitive" },
      name: { equals: parsed.repository, mode: "insensitive" },
    },
    select: {
      externalRepositoryId: true,
      ownerLogin: true,
      name: true,
      installation: { select: { externalInstallationId: true } },
    },
  });
  if (!connection?.installation) throw new TicketFetchError("repository_not_connected");

  let issue;
  try {
    issue = await (dependencies?.fetchIssue ?? fetchGitHubIssue)({
      installationId: connection.installation.externalInstallationId,
      externalRepositoryId: connection.externalRepositoryId,
      ownerLogin: connection.ownerLogin,
      repositoryName: connection.name,
      issueNumber: parsed.number,
    });
  } catch (error) {
    if (error instanceof GitHubIssueError) {
      if (error.code === "github_unavailable") throw new TicketFetchError("github_unavailable");
      throw new TicketFetchError(error.code);
    }
    throw new TicketFetchError("github_unavailable");
  }

  const reference = `${connection.ownerLogin}/${connection.name}#${issue.number}`;
  return {
    // The same shape a person pastes: a title line, then the body. Labels are
    // included because they often carry the only statement of scope a ticket
    // has.
    ticket: [
      issue.title,
      issue.labels.length ? `Labels: ${issue.labels.join(", ")}` : "",
      "",
      issue.body,
    ]
      .filter((part, index) => part !== "" || index === 2)
      .join("\n")
      .trim(),
    url: issue.url,
    reference,
  };
}
