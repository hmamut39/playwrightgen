import "server-only";

import { z } from "zod";

import { validateGitHubAppAuthenticationEnvironment } from "@/lib/env";
import { createGitHubAppJwt, GitHubProviderError } from "@/lib/integrations/github/app-client";

/**
 * Reading what a team already calls a release.
 *
 * A sprint or a release is a time-box, and a time-box is a mutable thing that
 * lives in the tracker where the team edits it daily. Giving PlaywrightGen its
 * own would mean two of them, disagreeing within a week, and a tab to maintain
 * the disagreement in. So the grouping is read from the tracker instead: a
 * GitHub milestone is a set of issues, a requirement already carries the
 * reference of the issue it was drafted from, and that is enough to answer
 * "what is the evidence for this release" without inventing anything.
 *
 * Reads only. The token carries `issues: read` alone, which is also what
 * milestones are read under, and there is no write path here at all.
 */

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";

const tokenSchema = z.object({ token: z.string().min(1), expires_at: z.string().min(1) });

const milestoneSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.string(),
  open_issues: z.number().int().nonnegative(),
  closed_issues: z.number().int().nonnegative(),
});
const milestoneListSchema = z.array(milestoneSchema);

const issueSchema = z.object({
  number: z.number().int().positive(),
  // A pull request is an issue to this API and is never a requirement.
  pull_request: z.unknown().optional(),
});
const issueListSchema = z.array(issueSchema);

export type GitHubMilestone = {
  number: number;
  title: string;
  state: string;
  issueCount: number;
};

export class MilestoneError extends Error {
  constructor(readonly code: "permission_missing" | "github_unavailable") {
    super(code);
    this.name = "MilestoneError";
  }
}

async function request<T>(
  fetcher: typeof fetch,
  path: string,
  token: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const response = await fetcher(`${GITHUB_API}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "playwrightgen",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) return { ok: false, status: response.status };
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new MilestoneError("github_unavailable");
  return { ok: true, data: parsed.data };
}

async function readToken(input: {
  fetcher: typeof fetch;
  installationId: string;
  externalRepositoryId: string;
  appId: string;
  privateKey: string;
}) {
  const repositoryId = Number(input.externalRepositoryId);
  if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
    throw new GitHubProviderError("github_repository_id_invalid");
  }
  const appJwt = createGitHubAppJwt({ appId: input.appId, privateKey: input.privateKey });
  const result = await request(
    input.fetcher,
    `/app/installations/${encodeURIComponent(input.installationId)}/access_tokens`,
    appJwt,
    tokenSchema,
    {
      method: "POST",
      body: JSON.stringify({ repository_ids: [repositoryId], permissions: { issues: "read" } }),
    },
  );
  if (!result.ok) throw new MilestoneError("permission_missing");
  return result.data.token;
}

type Repository = {
  installationId: string;
  externalRepositoryId: string;
  ownerLogin: string;
  repositoryName: string;
  fetcher?: typeof fetch;
  environment?: Readonly<Record<string, string | undefined>>;
};

/** Every milestone the repository has, newest first, open ones before closed. */
export async function listMilestones(input: Repository): Promise<GitHubMilestone[]> {
  const environment = validateGitHubAppAuthenticationEnvironment(input.environment);
  const fetcher = input.fetcher ?? fetch;
  const token = await readToken({
    fetcher,
    installationId: input.installationId,
    externalRepositoryId: input.externalRepositoryId,
    appId: environment.GITHUB_APP_ID,
    privateKey: environment.GITHUB_APP_PRIVATE_KEY,
  });

  const result = await request(
    fetcher,
    `/repos/${encodeURIComponent(input.ownerLogin)}/${encodeURIComponent(input.repositoryName)}/milestones?state=all&per_page=100&sort=due_on&direction=desc`,
    token,
    milestoneListSchema,
  );
  if (!result.ok) throw new MilestoneError("permission_missing");

  return result.data
    .map((milestone) => ({
      number: milestone.number,
      title: milestone.title,
      state: milestone.state,
      issueCount: milestone.open_issues + milestone.closed_issues,
    }))
    .sort((left, right) => {
      if (left.state !== right.state) return left.state === "open" ? -1 : 1;
      return right.number - left.number;
    });
}

/**
 * The references of the issues in one milestone, in the form a requirement
 * stores them: `owner/repository#number`.
 *
 * Pull requests are dropped. GitHub returns them from this endpoint and a pull
 * request is never the thing a requirement was drafted from.
 */
export async function listMilestoneReferences(
  input: Repository & { milestoneNumber: number },
): Promise<string[]> {
  const environment = validateGitHubAppAuthenticationEnvironment(input.environment);
  const fetcher = input.fetcher ?? fetch;
  const token = await readToken({
    fetcher,
    installationId: input.installationId,
    externalRepositoryId: input.externalRepositoryId,
    appId: environment.GITHUB_APP_ID,
    privateKey: environment.GITHUB_APP_PRIVATE_KEY,
  });

  const references: string[] = [];
  // Bounded: a milestone with more than a few hundred issues is not a release
  // anybody is reading evidence for one page at a time.
  for (let page = 1; page <= 3; page += 1) {
    const result = await request(
      fetcher,
      `/repos/${encodeURIComponent(input.ownerLogin)}/${encodeURIComponent(input.repositoryName)}/issues?milestone=${input.milestoneNumber}&state=all&per_page=100&page=${page}`,
      token,
      issueListSchema,
    );
    if (!result.ok) throw new MilestoneError("permission_missing");

    for (const issue of result.data) {
      if (issue.pull_request) continue;
      references.push(`${input.ownerLogin}/${input.repositoryName}#${issue.number}`);
    }
    if (result.data.length < 100) break;
  }

  return references;
}
