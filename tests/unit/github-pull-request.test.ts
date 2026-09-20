import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { openPullRequest } from "@/lib/integrations/github/pull-request";

// A real key pair, made here: the JWT is signed before any request is sent.
const PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;

type Call = { method: string; path: string; body: unknown };

function fakeGitHub(overrides: { branchExists?: boolean; fileExists?: boolean; openPull?: boolean; tokenStatus?: number } = {}) {
  const calls: Call[] = [];
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace("https://api.github.com", "");
    const method = init?.method ?? "GET";
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const json = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

    if (path.endsWith("/access_tokens")) {
      return overrides.tokenStatus
        ? json(overrides.tokenStatus, { message: "nope" })
        : json(201, { token: "ghs_test", expires_at: "2026-01-01T00:00:00Z" });
    }
    if (path.includes("/git/ref/heads/main")) return json(200, { object: { sha: "a".repeat(40) } });
    if (path.includes("/git/ref/heads/playwrightgen")) {
      return overrides.branchExists ? json(200, { object: { sha: "b".repeat(40) } }) : json(404, { message: "Not Found" });
    }
    if (path.includes("/git/refs") && method === "POST") return json(201, { object: { sha: "b".repeat(40) } });
    if (path.includes("/contents/") && method === "GET") {
      return overrides.fileExists ? json(200, { sha: "c".repeat(40) }) : json(404, { message: "Not Found" });
    }
    if (path.includes("/contents/") && method === "PUT") return json(201, { content: { sha: "d".repeat(40) } });
    if (path.includes("/pulls?") ) {
      return json(200, overrides.openPull ? [{ number: 7, html_url: "https://github.com/acme/web/pull/7", state: "open" }] : []);
    }
    if (path.endsWith("/pulls") && method === "POST") {
      return json(201, { number: 12, html_url: "https://github.com/acme/web/pull/12", state: "open" });
    }
    return json(500, { message: "unexpected" });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

const input = {
  installationId: "555",
  externalRepositoryId: "9001",
  owner: "acme",
  repo: "web",
  baseBranch: "main",
  branch: "playwrightgen/adds-a-todo-v1",
  title: "Add approved Playwright test: A visitor adds a todo",
  body: "Approved automation.",
  files: [{ path: "tests/playwrightgen/adds-a-todo.spec.ts", content: "import { test } from '@playwright/test';\n" }],
  environment: { GITHUB_APP_ID: "12345", GITHUB_APP_PRIVATE_KEY: PRIVATE_KEY },
};

describe("opening a pull request with approved automation", () => {
  it("asks for the least it needs, branches from the default branch, writes the file and opens the pull request", async () => {
    const github = fakeGitHub();
    const result = await openPullRequest({ ...input, fetcher: github.fetcher });

    expect(result).toEqual({ url: "https://github.com/acme/web/pull/12", number: 12, branch: input.branch, created: true });
    const token = github.calls[0];
    expect(token.path).toBe("/app/installations/555/access_tokens");
    // One repository, and only the two permissions a pull request needs.
    expect(token.body).toEqual({ repository_ids: [9001], permissions: { contents: "write", pull_requests: "write" } });
    const created = github.calls.find((call) => call.path.endsWith("/git/refs") && call.method === "POST");
    expect(created?.body).toEqual({ ref: "refs/heads/playwrightgen/adds-a-todo-v1", sha: "a".repeat(40) });
    const write = github.calls.find((call) => call.method === "PUT");
    expect(write?.path).toBe("/repos/acme/web/contents/tests/playwrightgen/adds-a-todo.spec.ts");
    expect(Buffer.from((write?.body as { content: string }).content, "base64").toString("utf8")).toContain("@playwright/test");
    expect((write?.body as { branch: string }).branch).toBe(input.branch);
    // Never a push to the default branch.
    expect(github.calls.every((call) => call.method === "GET" || !JSON.stringify(call.body ?? {}).includes('"branch":"main"'))).toBe(true);
  });

  it("updates an existing branch and returns the pull request already open for it", async () => {
    const github = fakeGitHub({ branchExists: true, fileExists: true, openPull: true });
    const result = await openPullRequest({ ...input, fetcher: github.fetcher });

    expect(result).toMatchObject({ url: "https://github.com/acme/web/pull/7", number: 7, created: false });
    expect(github.calls.some((call) => call.path.endsWith("/git/refs") && call.method === "POST")).toBe(false);
    expect((github.calls.find((call) => call.method === "PUT")?.body as { sha?: string }).sha).toBe("c".repeat(40));
    expect(github.calls.some((call) => call.path.endsWith("/pulls") && call.method === "POST")).toBe(false);
  });

  it("says plainly when the app was never granted write access, and writes nothing", async () => {
    const github = fakeGitHub({ tokenStatus: 422 });
    await expect(openPullRequest({ ...input, fetcher: github.fetcher })).rejects.toMatchObject({
      code: "github_pull_request_permission_missing",
    });
    expect(github.calls).toHaveLength(1);
  });
});
