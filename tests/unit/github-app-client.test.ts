import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createGitHubAppJwt,
  createGitHubRepositorySnapshotProvider,
  exchangeGitHubUserCode,
  getGitHubPublicRepository,
  getVerifiedGitHubInstallation,
  listGitHubInstallationRepositories,
  verifyGitHubUserInstallationAccess,
} from "@/lib/integrations/github/app-client";

function privateKey() {
  return generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function setupEnvironment(key: string) {
  return {
    GITHUB_APP_ID: "123",
    GITHUB_APP_PRIVATE_KEY: key,
    GITHUB_APP_SLUG: "playwrightgen-dev",
    GITHUB_APP_CLIENT_ID: "Iv1.client",
    GITHUB_APP_CLIENT_SECRET: "client-secret-never-stored",
    GITHUB_SETUP_STATE_SECRET:
      "github-setup-state-secret-that-is-long-enough",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  };
}

describe("least-privilege GitHub App client", () => {
  it("creates a short-lived app JWT", () => {
    const now = new Date("2026-08-25T12:00:00.000Z");
    const jwt = createGitHubAppJwt({ appId: "123", privateKey: privateKey(), now });
    const [, encodedPayload] = jwt.split(".");
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as { iat: number; exp: number; iss: string };

    expect(payload.iss).toBe("123");
    expect(payload.exp - payload.iat).toBe(600);
  });

  it("mints a repository-restricted read token and returns bounded source evidence", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        token: "installation-token-never-returned",
        expires_at: "2026-08-25T12:30:00Z",
      }))
      .mockResolvedValueOnce(jsonResponse({
        sha: "a".repeat(40),
        commit: { tree: { sha: "tree-sha" } },
      }))
      .mockResolvedValueOnce(jsonResponse({
        truncated: false,
        tree: [
          {
            path: "playwright.config.ts",
            type: "blob",
            sha: "config-blob",
            size: 20,
          },
          {
            path: ".env",
            type: "blob",
            sha: "secret-blob",
            size: 20,
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        content: Buffer.from("export default {}", "utf8").toString("base64"),
        encoding: "base64",
      }));
    const provider = createGitHubRepositorySnapshotProvider({
      fetcher,
      environment: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: privateKey(),
        GITHUB_WEBHOOK_SECRET: "webhook-secret",
      },
    });

    const snapshot = await provider({
      externalInstallationId: "456",
      externalRepositoryId: "789",
      ownerLogin: "acme",
      repositoryName: "storefront",
      sourceRef: "main",
      visibility: "PRIVATE",
    });

    const tokenRequest = fetcher.mock.calls[0];
    expect(tokenRequest[0]).toBe(
      "https://api.github.com/app/installations/456/access_tokens",
    );
    expect(JSON.parse(String(tokenRequest[1]?.body))).toEqual({
      repository_ids: [789],
      permissions: { contents: "read" },
    });
    expect(snapshot).toMatchObject({
      externalRepositoryId: "789",
      commitSha: "a".repeat(40),
      truncated: false,
      files: [{ path: "playwright.config.ts", content: "export default {}" }],
    });
    expect(snapshot.files).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain("installation-token");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("verifies public repository metadata with an installation token", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        token: "installation-token-never-returned",
        expires_at: "2026-08-25T12:30:00Z",
      }))
      .mockResolvedValueOnce(jsonResponse({
        id: 789,
        name: "playwrightgen",
        full_name: "hasan-gen/playwrightgen",
        owner: { login: "hasan-gen" },
        default_branch: "main",
        visibility: "public",
        private: false,
      }));

    const repository = await getGitHubPublicRepository({
      installationId: "456",
      ownerLogin: "hasan-gen",
      repositoryName: "playwrightgen",
      fetcher,
      environment: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: privateKey(),
      },
    });

    expect(repository).toMatchObject({
      externalRepositoryId: "789",
      fullName: "hasan-gen/playwrightgen",
      visibility: "PUBLIC",
    });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      permissions: { contents: "read" },
    });
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://api.github.com/repos/hasan-gen/playwrightgen",
    );
  });

  it("imports a public repository without requesting private installation scope", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        token: "installation-token-never-returned",
        expires_at: "2026-08-25T12:30:00Z",
      }))
      .mockResolvedValueOnce(jsonResponse({
        sha: "b".repeat(40),
        commit: { tree: { sha: "tree-sha" } },
      }))
      .mockResolvedValueOnce(jsonResponse({
        truncated: false,
        tree: [],
      }));
    const provider = createGitHubRepositorySnapshotProvider({
      fetcher,
      environment: {
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: privateKey(),
      },
    });

    await provider({
      externalInstallationId: "456",
      externalRepositoryId: "789",
      ownerLogin: "hasan-gen",
      repositoryName: "playwrightgen",
      sourceRef: "main",
      visibility: "PUBLIC",
    });

    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({
      permissions: { contents: "read" },
    });
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://api.github.com/repos/hasan-gen/playwrightgen/commits/main",
    );
  });

  it("verifies the GitHub user, App installation, and live repository access", async () => {
    const key = privateKey();
    const repository = {
      id: 789,
      name: "storefront",
      full_name: "acme/storefront",
      owner: { login: "acme" },
      default_branch: "main",
      visibility: "private",
      private: true,
    };
    const oauthFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        access_token: "transient-user-token",
        token_type: "bearer",
      }));
    const userToken = await exchangeGitHubUserCode({
      code: "one-time-code",
      codeVerifier: "v".repeat(43),
      redirectUri: "http://localhost:3000/api/github/setup/callback",
      fetcher: oauthFetcher,
      environment: setupEnvironment(key),
    });
    expect(userToken).toBe("transient-user-token");
    expect(JSON.parse(String(oauthFetcher.mock.calls[0][1]?.body))).toMatchObject({
      code_verifier: "v".repeat(43),
    });

    const userFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        total_count: 1,
        repositories: [repository],
      }));
    await verifyGitHubUserInstallationAccess({
      installationId: "456",
      userToken,
      fetcher: userFetcher,
    });
    expect(userFetcher.mock.calls[0][0]).toContain(
      "/user/installations/456/repositories",
    );

    const installationFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        id: 456,
        app_id: 123,
        account: { id: 321, login: "acme", type: "Organization" },
        repository_selection: "selected",
        permissions: { metadata: "read", contents: "read" },
        suspended_at: null,
        created_at: "2026-08-26T12:00:00.000Z",
        updated_at: "2026-08-26T12:01:00.000Z",
      }));
    expect(await getVerifiedGitHubInstallation({
      installationId: "456",
      fetcher: installationFetcher,
      environment: setupEnvironment(key),
    })).toMatchObject({
      externalInstallationId: "456",
      accountId: "321",
      accountLogin: "acme",
      repositorySelection: "selected",
    });

    const repositoryFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        token: "transient-installation-token",
        expires_at: "2026-08-26T13:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse({
        total_count: 1,
        repositories: [repository],
      }));
    const repositories = await listGitHubInstallationRepositories({
      installationId: "456",
      fetcher: repositoryFetcher,
      environment: setupEnvironment(key),
    });
    expect(repositories).toEqual([{
      externalRepositoryId: "789",
      ownerLogin: "acme",
      name: "storefront",
      fullName: "acme/storefront",
      defaultBranch: "main",
      visibility: "PRIVATE",
    }]);
    expect(JSON.stringify(repositories)).not.toContain("transient-installation-token");
  });

  it("accepts an installation that may also read issues", async () => {
    const key = privateKey();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      id: 456,
      app_id: 123,
      account: { id: 321, login: "acme", type: "Organization" },
      repository_selection: "selected",
      // What the installation looks like once the owner has accepted the
      // request that lets a ticket be fetched instead of pasted.
      permissions: { metadata: "read", contents: "read", issues: "read" },
      suspended_at: null,
      created_at: "2026-08-26T12:00:00.000Z",
      updated_at: "2026-08-26T12:01:00.000Z",
    }));

    const installation = await getVerifiedGitHubInstallation({
      installationId: "456",
      fetcher,
      environment: setupEnvironment(key),
    });

    expect(installation.externalInstallationId).toBe("456");
  });

  it("still refuses to let issues be written", async () => {
    const key = privateKey();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      id: 456,
      app_id: 123,
      account: { id: 321, login: "acme", type: "Organization" },
      repository_selection: "selected",
      // Read is the whole point: PlaywrightGen reads a ticket and never
      // changes one.
      permissions: { metadata: "read", contents: "read", issues: "write" },
      suspended_at: null,
      created_at: "2026-08-26T12:00:00.000Z",
      updated_at: "2026-08-26T12:01:00.000Z",
    }));

    await expect(getVerifiedGitHubInstallation({
      installationId: "456",
      fetcher,
      environment: setupEnvironment(key),
    })).rejects.toMatchObject({
      code: "github_permissions_not_least_privilege",
    });
  });

  it("rejects an installation when the App has broader than read-only permissions", async () => {
    const key = privateKey();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({
      id: 456,
      app_id: 123,
      account: { id: 321, login: "acme", type: "Organization" },
      repository_selection: "selected",
      permissions: {
        metadata: "read",
        contents: "read",
        pull_requests: "write",
      },
      suspended_at: null,
      created_at: "2026-08-26T12:00:00.000Z",
      updated_at: "2026-08-26T12:01:00.000Z",
    }));

    await expect(getVerifiedGitHubInstallation({
      installationId: "456",
      fetcher,
      environment: setupEnvironment(key),
    })).rejects.toMatchObject({
      code: "github_permissions_not_least_privilege",
    });
  });
});
