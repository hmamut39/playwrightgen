import "server-only";

import { z } from "zod";

import { validateGitHubAppAuthenticationEnvironment } from "@/lib/env";
import { createGitHubAppJwt, GitHubProviderError } from "@/lib/integrations/github/app-client";

/**
 * Reading one issue out of a connected repository.
 *
 * A requirement could already be drafted from a ticket, as long as somebody
 * pasted it. Pasting is where detail goes missing -- a body truncated at the
 * scroll, a comment left behind -- and the fetch removes that step for the
 * repositories a project has already connected.
 *
 * The token it mints lasts minutes, is scoped to that one repository, and
 * carries `issues: read` and nothing else. There is no write path here at all:
 * PlaywrightGen reads a ticket and never changes one, and the App's permission
 * ceiling refuses `issues: write` so it could not acquire that ability later.
 */

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";

const tokenSchema = z.object({ token: z.string().min(1), expires_at: z.string().min(1) });

const issueSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullable(),
  state: z.string().min(1),
  html_url: z.string().url(),
  // A pull request is also an issue to GitHub's API, and drafting a
  // requirement from one would be nonsense, so it is told apart here.
  pull_request: z.unknown().optional(),
  labels: z
    .array(z.union([z.string(), z.object({ name: z.string().optional() })]))
    .optional(),
});

export type GitHubIssue = {
  number: number;
  title: string;
  body: string;
  state: string;
  url: string;
  labels: string[];
};

export class GitHubIssueError extends Error {
  constructor(
    readonly code:
      | "issue_not_found"
      | "issue_permission_missing"
      | "issue_is_a_pull_request"
      | "github_unavailable",
  ) {
    super(code);
    this.name = "GitHubIssueError";
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
      ...(init?.headers ?? {}),
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "playwrightgen",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) return { ok: false, status: response.status };
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new GitHubIssueError("github_unavailable");
  return { ok: true, data: parsed.data };
}

/** A short-lived token for one repository that may only read issues. */
async function issueToken(input: {
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
      body: JSON.stringify({
        repository_ids: [repositoryId],
        permissions: { issues: "read" },
      }),
    },
  );
  // GitHub refuses a token asking for more than the App was granted, which is
  // what an installation whose owner has not accepted the request looks like.
  if (!result.ok) {
    if (result.status === 422 || result.status === 403) {
      throw new GitHubIssueError("issue_permission_missing");
    }
    throw new GitHubIssueError("github_unavailable");
  }
  return result.data.token;
}

export async function fetchGitHubIssue(input: {
  installationId: string;
  externalRepositoryId: string;
  ownerLogin: string;
  repositoryName: string;
  issueNumber: number;
  fetcher?: typeof fetch;
  environment?: Readonly<Record<string, string | undefined>>;
}): Promise<GitHubIssue> {
  const environment = validateGitHubAppAuthenticationEnvironment(input.environment);
  const fetcher = input.fetcher ?? fetch;

  const token = await issueToken({
    fetcher,
    installationId: input.installationId,
    externalRepositoryId: input.externalRepositoryId,
    appId: environment.GITHUB_APP_ID,
    privateKey: environment.GITHUB_APP_PRIVATE_KEY,
  });

  const result = await request(
    fetcher,
    `/repos/${encodeURIComponent(input.ownerLogin)}/${encodeURIComponent(input.repositoryName)}/issues/${input.issueNumber}`,
    token,
    issueSchema,
  );
  if (!result.ok) {
    // 404 and 403 both mean "not yours to read here", and saying which would
    // tell a caller whether a private issue exists.
    if (result.status === 404 || result.status === 403) {
      throw new GitHubIssueError("issue_not_found");
    }
    throw new GitHubIssueError("github_unavailable");
  }
  if (result.data.pull_request) throw new GitHubIssueError("issue_is_a_pull_request");

  return {
    number: result.data.number,
    title: result.data.title,
    body: result.data.body ?? "",
    state: result.data.state,
    url: result.data.html_url,
    labels: (result.data.labels ?? [])
      .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
      .filter(Boolean),
  };
}
