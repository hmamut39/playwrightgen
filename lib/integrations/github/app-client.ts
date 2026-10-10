import "server-only";

import { createSign } from "node:crypto";

import { z } from "zod";

import {
  validateGitHubAppAuthenticationEnvironment,
  validateGitHubSetupEnvironment,
} from "@/lib/env";
import type {
  RepositorySnapshotProvider,
  RepositorySourceSnapshot,
} from "@/lib/services/repository-imports";

const GITHUB_API = "https://api.github.com";
const GITHUB_API_VERSION = "2026-03-10";
const MAX_CANDIDATE_FILES = 1_000;
const MAX_CANDIDATE_BYTES = 512_000;
const BLOB_FETCH_CONCURRENCY = 8;

const tokenResponseSchema = z.object({
  token: z.string().min(1),
  expires_at: z.string().min(1),
});
const commitResponseSchema = z.object({
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  commit: z.object({
    tree: z.object({ sha: z.string().min(1).max(64) }),
  }),
});
const treeResponseSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(z.object({
    path: z.string().min(1).max(1_000),
    mode: z.string().optional(),
    type: z.string(),
    sha: z.string().min(1).max(64),
    size: z.number().int().min(0).optional(),
  })).max(100_000),
});
const blobResponseSchema = z.object({
  content: z.string(),
  encoding: z.literal("base64"),
});
const oauthTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().min(1),
});
const installationResponseSchema = z.object({
  id: z.union([z.number().int().positive().safe(), z.string().regex(/^\d+$/)])
    .transform(String),
  app_id: z.union([z.number().int().positive().safe(), z.string().regex(/^\d+$/)])
    .transform(String),
  account: z.object({
    id: z.union([z.number().int().positive().safe(), z.string().regex(/^\d+$/)])
      .transform(String),
    login: z.string().trim().min(1).max(255),
    type: z.string().trim().min(1).max(50),
  }),
  repository_selection: z.enum(["all", "selected"]),
  permissions: z.record(z.string(), z.string()),
  suspended_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const repositorySchema = z.object({
  id: z.union([z.number().int().positive().safe(), z.string().regex(/^\d+$/)])
    .transform(String),
  name: z.string().trim().min(1).max(255),
  full_name: z.string().trim().min(3).max(511),
  owner: z.object({ login: z.string().trim().min(1).max(255) }),
  default_branch: z.string().trim().min(1).max(255),
  visibility: z.enum(["public", "private", "internal"]).optional(),
  private: z.boolean(),
});
const repositoryListSchema = z.object({
  total_count: z.number().int().min(0),
  repositories: z.array(repositorySchema).max(100),
});

export type GitHubAccessibleRepository = {
  externalRepositoryId: string;
  ownerLogin: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  visibility: "PUBLIC" | "PRIVATE" | "INTERNAL" | "UNKNOWN";
};

export type VerifiedGitHubInstallation = {
  externalInstallationId: string;
  accountId: string;
  accountLogin: string;
  accountType: string;
  repositorySelection: "all" | "selected";
  installedAt: Date;
  providerUpdatedAt: Date;
};

export class GitHubProviderError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "GitHubProviderError";
    this.code = code;
  }
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("=", "")
    .replaceAll("+", "-")
    .replaceAll("/", "_");
}

function normalizePrivateKey(value: string): string {
  return value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
}

function repositoryVisibility(
  repository: z.infer<typeof repositorySchema>,
): GitHubAccessibleRepository["visibility"] {
  if (repository.visibility === "public") return "PUBLIC";
  if (repository.visibility === "private") return "PRIVATE";
  if (repository.visibility === "internal") return "INTERNAL";
  return repository.private ? "PRIVATE" : "UNKNOWN";
}

function normalizeRepository(
  repository: z.infer<typeof repositorySchema>,
): GitHubAccessibleRepository {
  return {
    externalRepositoryId: repository.id,
    ownerLogin: repository.owner.login,
    name: repository.name,
    fullName: repository.full_name,
    defaultBranch: repository.default_branch,
    visibility: repositoryVisibility(repository),
  };
}

export function createGitHubAppJwt(input: {
  appId: string;
  privateKey: string;
  now?: Date;
}): string {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: input.appId,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${base64Url(signer.sign(normalizePrivateKey(input.privateKey)))}`;
}

function candidatePath(path: string): boolean {
  const fileName = path.toLowerCase().split("/").at(-1) ?? path.toLowerCase();
  return (
    /^playwright\.config\.(?:ts|js|mts|mjs|cts|cjs)$/.test(fileName) ||
    /\.(?:spec|test)\.(?:ts|tsx|js|jsx|mts|mjs|cts|cjs)$/.test(fileName) ||
    fileName === "package.json" ||
    fileName === "package-lock.json" ||
    fileName === "pnpm-lock.yaml" ||
    fileName === "yarn.lock" ||
    /^tsconfig(?:\..+)?\.json$/.test(fileName)
  );
}

async function githubRequest<T>(
  fetcher: typeof fetch,
  path: string,
  token: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetcher(`${GITHUB_API}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new GitHubProviderError(`github_http_${response.status}`);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new GitHubProviderError("github_response_invalid");
  }
  return parsed.data;
}

async function installationToken(input: {
  fetcher: typeof fetch;
  appJwt: string;
  installationId: string;
  repositoryId?: string;
}) {
  let repositoryIds: number[] | undefined;
  if (input.repositoryId) {
    const repositoryId = Number(input.repositoryId);
    if (!Number.isSafeInteger(repositoryId) || repositoryId <= 0) {
      throw new GitHubProviderError("github_repository_id_invalid");
    }
    repositoryIds = [repositoryId];
  }
  return githubRequest(
    input.fetcher,
    `/app/installations/${encodeURIComponent(input.installationId)}/access_tokens`,
    input.appJwt,
    tokenResponseSchema,
    {
      method: "POST",
      body: JSON.stringify({
        ...(repositoryIds ? { repository_ids: repositoryIds } : {}),
        permissions: { contents: "read" },
      }),
      headers: { "Content-Type": "application/json" },
    },
  );
}

async function listAllInstallationRepositories(input: {
  fetcher: typeof fetch;
  token: string;
  path: string;
}): Promise<GitHubAccessibleRepository[]> {
  const repositories: GitHubAccessibleRepository[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const separator = input.path.includes("?") ? "&" : "?";
    const result = await githubRequest(
      input.fetcher,
      input.path + separator + "per_page=100&page=" + page,
      input.token,
      repositoryListSchema,
    );
    repositories.push(...result.repositories.map(normalizeRepository));
    if (repositories.length >= result.total_count || result.repositories.length < 100) {
      return repositories;
    }
  }
  throw new GitHubProviderError("github_repository_list_too_large");
}

export async function exchangeGitHubUserCode(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  fetcher?: typeof fetch;
  environment?: Readonly<Record<string, string | undefined>>;
}): Promise<string> {
  const environment = validateGitHubSetupEnvironment(input.environment);
  const response = await (input.fetcher ?? fetch)(
    "https://github.com/login/oauth/access_token",
    {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: environment.GITHUB_APP_CLIENT_ID,
        client_secret: environment.GITHUB_APP_CLIENT_SECRET,
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      }),
    },
  );
  if (!response.ok) {
    throw new GitHubProviderError("github_oauth_exchange_failed");
  }
  const parsed = oauthTokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new GitHubProviderError("github_oauth_response_invalid");
  }
  return parsed.data.access_token;
}

export async function verifyGitHubUserInstallationAccess(input: {
  installationId: string;
  userToken: string;
  fetcher?: typeof fetch;
}): Promise<void> {
  await listAllInstallationRepositories({
    fetcher: input.fetcher ?? fetch,
    token: input.userToken,
    path:
      "/user/installations/" +
      encodeURIComponent(input.installationId) +
      "/repositories",
  });
}

/**
 * Every permission this App is allowed to hold, each at read.
 *
 * The check stays an allowlist rather than a list of things to avoid: a
 * permission nobody thought about is refused by default, which is the only
 * version of least privilege that survives someone editing the App later.
 *
 * `contents` is required -- without it there is no repository to read.
 * `metadata` comes with every installation. `issues` is optional and is what
 * lets a ticket be fetched instead of pasted; an installation that has not
 * been granted it, or whose owner has not yet accepted the request, verifies
 * exactly as before and simply cannot fetch tickets.
 */
const ALLOWED_PERMISSIONS = new Set(["contents", "metadata", "issues"]);

export async function getVerifiedGitHubInstallation(input: {
  installationId: string;
  fetcher?: typeof fetch;
  environment?: Readonly<Record<string, string | undefined>>;
}): Promise<VerifiedGitHubInstallation> {
  const environment = validateGitHubSetupEnvironment(input.environment);
  const fetcher = input.fetcher ?? fetch;
  const appJwt = createGitHubAppJwt({
    appId: environment.GITHUB_APP_ID,
    privateKey: environment.GITHUB_APP_PRIVATE_KEY,
  });
  const installation = await githubRequest(
    fetcher,
    "/app/installations/" + encodeURIComponent(input.installationId),
    appJwt,
    installationResponseSchema,
  );
  if (installation.app_id !== environment.GITHUB_APP_ID) {
    throw new GitHubProviderError("github_installation_app_mismatch");
  }
  if (installation.suspended_at) {
    throw new GitHubProviderError("github_installation_suspended");
  }
  const permissions = Object.entries(installation.permissions);
  if (
    installation.permissions.contents !== "read" ||
    permissions.some(
      ([name, level]) =>
        !ALLOWED_PERMISSIONS.has(name) || level !== "read",
    )
  ) {
    throw new GitHubProviderError("github_permissions_not_least_privilege");
  }
  const installedAt = new Date(installation.created_at);
  const providerUpdatedAt = new Date(installation.updated_at);
  if (
    Number.isNaN(installedAt.getTime()) ||
    Number.isNaN(providerUpdatedAt.getTime())
  ) {
    throw new GitHubProviderError("github_response_invalid");
  }
  return {
    externalInstallationId: installation.id,
    accountId: installation.account.id,
    accountLogin: installation.account.login,
    accountType: installation.account.type,
    repositorySelection: installation.repository_selection,
    installedAt,
    providerUpdatedAt,
  };
}

export async function listGitHubInstallationRepositories(input: {
  installationId: string;
  fetcher?: typeof fetch;
  environment?: Readonly<Record<string, string | undefined>>;
}): Promise<GitHubAccessibleRepository[]> {
  const environment = validateGitHubAppAuthenticationEnvironment(
    input.environment,
  );
  const fetcher = input.fetcher ?? fetch;
  const appJwt = createGitHubAppJwt({
    appId: environment.GITHUB_APP_ID,
    privateKey: environment.GITHUB_APP_PRIVATE_KEY,
  });
  const access = await installationToken({
    fetcher,
    appJwt,
    installationId: input.installationId,
  });
  return listAllInstallationRepositories({
    fetcher,
    token: access.token,
    path: "/installation/repositories",
  });
}

export async function getGitHubPublicRepository(input: {
  installationId: string;
  ownerLogin: string;
  repositoryName: string;
  fetcher?: typeof fetch;
  environment?: Readonly<Record<string, string | undefined>>;
}): Promise<GitHubAccessibleRepository> {
  const environment = validateGitHubAppAuthenticationEnvironment(
    input.environment,
  );
  const fetcher = input.fetcher ?? fetch;
  const appJwt = createGitHubAppJwt({
    appId: environment.GITHUB_APP_ID,
    privateKey: environment.GITHUB_APP_PRIVATE_KEY,
  });
  const access = await installationToken({
    fetcher,
    appJwt,
    installationId: input.installationId,
  });
  const repository = normalizeRepository(await githubRequest(
    fetcher,
    `/repos/${encodeURIComponent(input.ownerLogin)}/${encodeURIComponent(input.repositoryName)}`,
    access.token,
    repositorySchema,
  ));
  if (repository.visibility !== "PUBLIC") {
    throw new GitHubProviderError("github_repository_not_public");
  }
  return repository;
}

export function createGitHubRepositorySnapshotProvider(input?: {
  fetcher?: typeof fetch;
  environment?: Readonly<Record<string, string | undefined>>;
}): RepositorySnapshotProvider {
  const environment = validateGitHubAppAuthenticationEnvironment(
    input?.environment,
  );
  const fetcher = input?.fetcher ?? fetch;

  return async (request): Promise<RepositorySourceSnapshot> => {
    const appJwt = createGitHubAppJwt({
      appId: environment.GITHUB_APP_ID,
      privateKey: environment.GITHUB_APP_PRIVATE_KEY,
    });
    const access = await installationToken({
      fetcher,
      appJwt,
      installationId: request.externalInstallationId,
      repositoryId:
        request.visibility === "PUBLIC"
          ? undefined
          : request.externalRepositoryId,
    });
    const owner = encodeURIComponent(request.ownerLogin);
    const repository = encodeURIComponent(request.repositoryName);
    const sourceRef = encodeURIComponent(request.sourceRef);
    const commit = await githubRequest(
      fetcher,
      `/repos/${owner}/${repository}/commits/${sourceRef}`,
      access.token,
      commitResponseSchema,
    );
    const tree = await githubRequest(
      fetcher,
      `/repos/${owner}/${repository}/git/trees/${encodeURIComponent(commit.commit.tree.sha)}?recursive=1`,
      access.token,
      treeResponseSchema,
    );
    const allCandidates = tree.tree.filter(
      (entry) => entry.type === "blob" && candidatePath(entry.path),
    );
    const candidates = allCandidates.slice(0, MAX_CANDIDATE_FILES);
    const files: RepositorySourceSnapshot["files"] = [];
    for (let offset = 0; offset < candidates.length; offset += BLOB_FETCH_CONCURRENCY) {
      const batch = candidates.slice(offset, offset + BLOB_FETCH_CONCURRENCY);
      files.push(...await Promise.all(batch.map(async (entry) => {
        const sizeBytes = entry.size ?? 0;
        if (sizeBytes > MAX_CANDIDATE_BYTES) {
          return { path: entry.path, blobSha: entry.sha, sizeBytes };
        }
        const blob = await githubRequest(
          fetcher,
          `/repos/${owner}/${repository}/git/blobs/${encodeURIComponent(entry.sha)}`,
          access.token,
          blobResponseSchema,
        );
        return {
          path: entry.path,
          blobSha: entry.sha,
          sizeBytes,
          content: Buffer.from(
            blob.content.replaceAll("\n", ""),
            "base64",
          ).toString("utf8"),
        };
      })));
    }

    return {
      externalRepositoryId: request.externalRepositoryId,
      commitSha: commit.sha,
      truncated: tree.truncated || allCandidates.length > MAX_CANDIDATE_FILES,
      files,
    };
  };
}
