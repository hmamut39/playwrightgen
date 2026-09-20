import "server-only";

import { z } from "zod";

import { validateGitHubAppAuthenticationEnvironment } from "@/lib/env";
import { createGitHubAppJwt, GitHubProviderError } from "@/lib/integrations/github/app-client";

/**
 * Approved automation, proposed to the team's repository as a pull request.
 *
 * Reviewed code that only lives in PlaywrightGen still has to be copied by
 * hand before CI can run it. This opens a branch and a pull request with the
 * approved file instead, so the repository's own review decides what lands.
 *
 * It never pushes to a default branch and never merges: the token it mints is
 * scoped to the one connected repository, lasts minutes, and carries only
 * `contents: write` (to create the branch and file) and `pull_requests: write`
 * (to open the pull request). A repository owner who has not granted those
 * permissions gets a plain error naming what is missing, and nothing is
 * written.
 */

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";

const tokenSchema = z.object({ token: z.string().min(1), expires_at: z.string().min(1) });
const refSchema = z.object({ object: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/) }) });
const contentSchema = z.object({ content: z.object({ sha: z.string().min(1) }).nullable() });
const existingFileSchema = z.object({ sha: z.string().min(1) });
const pullSchema = z.object({
  number: z.number().int().positive(),
  html_url: z.string().url(),
  state: z.string().min(1),
});
const pullListSchema = z.array(pullSchema);

export type AutomationPullRequest = { url: string; number: number; branch: string; created: boolean };

export type PullRequestFile = { path: string; content: string };

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
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) return { ok: false, status: response.status };
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new GitHubProviderError("github_response_invalid");
  return { ok: true, data: parsed.data };
}

function expect<T>(result: { ok: true; data: T } | { ok: false; status: number }, action: string): T {
  if (result.ok) return result.data;
  // 403 and 404 both mean "this installation may not do that here": GitHub
  // hides repositories it cannot see rather than admitting they exist.
  if (result.status === 403 || result.status === 404) {
    throw new GitHubProviderError("github_pull_request_permission_missing");
  }
  throw new GitHubProviderError(`github_${action}_http_${result.status}`);
}

/** A short-lived token for one repository with only what a pull request needs. */
async function pullRequestToken(input: {
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
        permissions: { contents: "write", pull_requests: "write" },
      }),
    },
  );
  // GitHub refuses a token asking for more than the app was granted.
  if (!result.ok && (result.status === 422 || result.status === 403)) {
    throw new GitHubProviderError("github_pull_request_permission_missing");
  }
  return expect(result, "installation_token").token;
}

/**
 * Creates (or updates) a branch, writes the files, and opens a pull request.
 * Calling it again for the same branch updates that branch and returns the
 * pull request already open for it.
 */
export async function openPullRequest(input: {
  installationId: string;
  externalRepositoryId: string;
  owner: string;
  repo: string;
  baseBranch: string;
  branch: string;
  title: string;
  body: string;
  files: PullRequestFile[];
  fetcher?: typeof fetch;
  environment?: { GITHUB_APP_ID: string; GITHUB_APP_PRIVATE_KEY: string };
}): Promise<AutomationPullRequest> {
  if (input.files.length === 0) throw new GitHubProviderError("github_pull_request_empty");
  const fetcher = input.fetcher ?? fetch;
  const environment = input.environment ?? validateGitHubAppAuthenticationEnvironment();
  const token = await pullRequestToken({
    fetcher,
    installationId: input.installationId,
    externalRepositoryId: input.externalRepositoryId,
    appId: environment.GITHUB_APP_ID,
    privateKey: environment.GITHUB_APP_PRIVATE_KEY,
  });
  const repo = `/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}`;
  const branchRef = `heads/${input.branch}`;

  const base = expect(
    await request(fetcher, `${repo}/git/ref/${encodeURI(`heads/${input.baseBranch}`)}`, token, refSchema),
    "base_ref",
  );
  const existingBranch = await request(fetcher, `${repo}/git/ref/${encodeURI(branchRef)}`, token, refSchema);
  if (!existingBranch.ok) {
    if (existingBranch.status !== 404) expect(existingBranch, "branch_ref");
    expect(
      await request(fetcher, `${repo}/git/refs`, token, refSchema, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/${branchRef}`, sha: base.object.sha }),
      }),
      "create_branch",
    );
  }

  for (const file of input.files) {
    const path = file.path.split("/").map(encodeURIComponent).join("/");
    const current = await request(fetcher, `${repo}/contents/${path}?ref=${encodeURIComponent(input.branch)}`, token, existingFileSchema);
    expect(
      await request(fetcher, `${repo}/contents/${path}`, token, contentSchema, {
        method: "PUT",
        body: JSON.stringify({
          message: input.title,
          content: Buffer.from(file.content, "utf8").toString("base64"),
          branch: input.branch,
          ...(current.ok ? { sha: current.data.sha } : {}),
        }),
      }),
      "write_file",
    );
  }

  const open = await request(
    fetcher,
    `${repo}/pulls?state=open&head=${encodeURIComponent(`${input.owner}:${input.branch}`)}`,
    token,
    pullListSchema,
  );
  if (open.ok && open.data.length > 0) {
    return { url: open.data[0].html_url, number: open.data[0].number, branch: input.branch, created: false };
  }
  const created = expect(
    await request(fetcher, `${repo}/pulls`, token, pullSchema, {
      method: "POST",
      body: JSON.stringify({ title: input.title, head: input.branch, base: input.baseBranch, body: input.body }),
    }),
    "create_pull_request",
  );
  return { url: created.html_url, number: created.number, branch: input.branch, created: true };
}
