import "server-only";

import { z } from "zod";

import { validateGitHubAppAuthenticationEnvironment } from "@/lib/env";
import { createGitHubAppJwt, GitHubProviderError } from "@/lib/integrations/github/app-client";

/**
 * Leaving what PlaywrightGen recorded on the pull request that caused it.
 *
 * Everything this product knows lives on its own pages, and a developer who
 * broke a test never opens them: their work happens in a pull request, and the
 * failure analysis, the requirement a test verifies and the approval behind it
 * all sit one website away from the moment the decision is made. CI already
 * says which tests failed. What nobody else can say is which requirement just
 * lost the only test that verified it.
 *
 * One comment per pull request, edited in place rather than appended to. A
 * comment per push turns a conversation into a log, and the second one is
 * where people stop reading.
 *
 * The token lasts minutes, covers the one connected repository, and carries
 * `pull_requests: write` alone -- not the `contents: write` the branch-opening
 * path needs, because nothing here writes a file.
 */

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";

/** Hidden in the comment so the next delivery can find and replace it. */
export const NOTE_MARKER = "<!-- playwrightgen:evidence -->";

const tokenSchema = z.object({ token: z.string().min(1), expires_at: z.string().min(1) });
const pullSchema = z.object({ number: z.number().int().positive(), state: z.string().min(1) });
const pullListSchema = z.array(pullSchema);
const commentSchema = z.object({ id: z.number().int().positive(), body: z.string().nullable() });
const commentListSchema = z.array(commentSchema);

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
      ...init?.headers,
    },
  });
  if (!response.ok) return { ok: false, status: response.status };
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new GitHubProviderError("github_response_invalid");
  return { ok: true, data: parsed.data };
}

/** A short-lived token for one repository that may only comment. */
async function noteToken(input: {
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
        permissions: { pull_requests: "write" },
      }),
    },
  );
  if (!result.ok) throw new GitHubProviderError("github_pull_request_permission_missing");
  return result.data.token;
}

export type PullRequestNote = {
  /** The pull requests the note was left on. Empty when the branch has none. */
  pullNumbers: number[];
  /** True where an existing note was edited rather than a new one added. */
  updated: boolean;
};

/**
 * Leaves the note on every open pull request for this branch.
 *
 * A branch usually has one, occasionally none, and rarely more than one. None
 * is the ordinary case for a push to a default branch and is not a failure.
 */
export async function leavePullRequestNote(input: {
  installationId: string;
  externalRepositoryId: string;
  ownerLogin: string;
  repositoryName: string;
  branch: string;
  body: string;
  fetcher?: typeof fetch;
  environment?: Readonly<Record<string, string | undefined>>;
}): Promise<PullRequestNote> {
  const environment = validateGitHubAppAuthenticationEnvironment(input.environment);
  const fetcher = input.fetcher ?? fetch;
  const repo = `/repos/${encodeURIComponent(input.ownerLogin)}/${encodeURIComponent(input.repositoryName)}`;

  const token = await noteToken({
    fetcher,
    installationId: input.installationId,
    externalRepositoryId: input.externalRepositoryId,
    appId: environment.GITHUB_APP_ID,
    privateKey: environment.GITHUB_APP_PRIVATE_KEY,
  });

  // head takes owner:branch, and a branch pushed from a fork belongs to the
  // fork's owner rather than this repository's.
  const open = await request(
    fetcher,
    `${repo}/pulls?state=open&head=${encodeURIComponent(`${input.ownerLogin}:${input.branch}`)}&per_page=10`,
    token,
    pullListSchema,
  );
  if (!open.ok) throw new GitHubProviderError("github_pull_request_permission_missing");

  const note: PullRequestNote = { pullNumbers: [], updated: false };
  for (const pull of open.data) {
    const existing = await request(
      fetcher,
      `${repo}/issues/${pull.number}/comments?per_page=100`,
      token,
      commentListSchema,
    );
    const mine = existing.ok
      ? existing.data.find((comment) => comment.body?.includes(NOTE_MARKER))
      : undefined;

    const written = mine
      ? await request(fetcher, `${repo}/issues/comments/${mine.id}`, token, commentSchema, {
          method: "PATCH",
          body: JSON.stringify({ body: input.body }),
        })
      : await request(fetcher, `${repo}/issues/${pull.number}/comments`, token, commentSchema, {
          method: "POST",
          body: JSON.stringify({ body: input.body }),
        });

    if (written.ok) {
      note.pullNumbers.push(pull.number);
      note.updated = note.updated || Boolean(mine);
    }
  }

  return note;
}
