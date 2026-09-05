import { createHmac } from "node:crypto";

import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleRunIngestRequest } from "@/app/api/runs/ingest/route";
import {
  deriveProjectRunnerToken,
  verifyRunnerSignature,
} from "@/lib/integrations/runner/ingest-token";
import {
  reserveRunIngest,
  RunIngestRateLimitError,
} from "@/lib/operations/run-ingest-guard";
import { RunIngestError } from "@/lib/services/test-run-ingest";

type RunIngestRouteReserve = typeof reserveRunIngest;

const SECRET = "runner-ingest-secret-for-tests-long-enough";
const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const OTHER_PROJECT = "33333333-3333-4333-8333-333333333333";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG,
    projectId: PROJECT,
    run: {
      provider: "github_actions",
      externalId: "9001-1",
      url: "https://github.com/acme/web/actions/runs/9001",
      commitSha: "a".repeat(40),
      ref: "main",
    },
    environment: "DEVELOPMENT",
    browser: "CHROMIUM",
    baseUrl: null,
    results: [
      {
        title: "[pwg:55555555-5555-4555-8555-555555555555] checkout succeeds",
        status: "passed",
        durationMs: 1200,
        steps: [{ title: "open cart", status: "passed" }],
      },
    ],
    ...overrides,
  };
}

function request(body: string, signature: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) headers["x-playwrightgen-signature"] = signature;

  return new Request("https://playwrightgen.example/api/runs/ingest", {
    method: "POST",
    headers,
    body,
  }) as unknown as NextRequest;
}

function signed(body: string, projectId = PROJECT, tokenVersion = 1) {
  const token = deriveProjectRunnerToken({
    secret: SECRET,
    organizationId: ORG,
    projectId,
    tokenVersion,
  });
  return `sha256=${createHmac("sha256", token).update(body, "utf8").digest("hex")}`;
}

function dependencies(
  ingest = vi.fn().mockResolvedValue({ recorded: 1, duplicates: 0, unmatched: 0 }),
  tokenVersion: number | null = 1,
  reserve: RunIngestRouteReserve = async () => ({
    minuteRemaining: 59,
    dailyResultsRemaining: 19_999,
  }),
) {
  return {
    deriveToken: deriveProjectRunnerToken,
    loadTokenVersion: async () => tokenVersion,
    reserve,
    // The real verifier, so these tests exercise the actual HMAC against the
    // token the route derived. A stub that ignored the derived token could not
    // detect a rotated version and would pass while production failed.
    verifySignature: verifyRunnerSignature,
    ingest,
  };
}

describe("run ingest route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function withSecret() {
    vi.stubEnv("RUNNER_INGEST_SECRET", SECRET);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  }

  it("records results when the signature matches the project token", async () => {
    withSecret();
    const body = JSON.stringify(validPayload());
    const ingest = vi.fn().mockResolvedValue({ recorded: 1, duplicates: 0, unmatched: 0 });

    const response = await handleRunIngestRequest(request(body, signed(body)), dependencies(ingest));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ok", recorded: 1 });
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("rejects a payload signed with another project's token", async () => {
    withSecret();
    const body = JSON.stringify(validPayload());
    const ingest = vi.fn();

    const response = await handleRunIngestRequest(
      request(body, signed(body, OTHER_PROJECT)),
      dependencies(ingest),
    );

    expect(response.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("rejects a token issued before the project's token was rotated", async () => {
    withSecret();
    const body = JSON.stringify(validPayload());
    const ingest = vi.fn();

    // The CI still holds a version 1 token; the project has moved to version 2.
    // That is what revocation looks like from the caller's side.
    const response = await handleRunIngestRequest(
      request(body, signed(body, PROJECT, 1)),
      dependencies(ingest, 2),
    );

    expect(response.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("accepts a token issued for the project's current version", async () => {
    withSecret();
    const body = JSON.stringify(validPayload());
    const ingest = vi.fn().mockResolvedValue({ recorded: 1, duplicates: 0, unmatched: 0 });
    const response = await handleRunIngestRequest(
      request(body, signed(body, PROJECT, 2)),
      dependencies(ingest, 2),
    );

    expect(response.status).toBe(200);
    expect(ingest).toHaveBeenCalledTimes(1);
  });

  it("reports an unknown project as an invalid signature, not a 404", async () => {
    withSecret();
    const body = JSON.stringify(validPayload());
    const ingest = vi.fn();

    // A 404 here would let an unauthenticated caller enumerate which
    // organization and project pairs exist by watching the status code.
    const response = await handleRunIngestRequest(
      request(body, signed(body)),
      dependencies(ingest, null),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_signature" });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("returns 429 when the organization's ingest quota is exhausted", async () => {
    withSecret();
    const body = JSON.stringify(validPayload());
    const ingest = vi.fn();

    const response = await handleRunIngestRequest(
      request(body, signed(body)),
      dependencies(ingest, 1, async () => {
        throw new RunIngestRateLimitError("ingest_daily_limit", 3_600);
      }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: "ingest_daily_limit" });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("does not spend quota on a request that fails verification", async () => {
    withSecret();
    const body = JSON.stringify(validPayload());
    const reserve = vi.fn();

    // An unauthenticated caller must not be able to exhaust a tenant's
    // allowance by posting garbage at the endpoint.
    const response = await handleRunIngestRequest(
      request(body, "sha256=" + "0".repeat(64)),
      dependencies(vi.fn(), 1, reserve),
    );

    expect(response.status).toBe(401);
    expect(reserve).not.toHaveBeenCalled();
  });

  it("reserves capacity for the number of results actually carried", async () => {
    withSecret();
    const payload = validPayload();
    payload.results = [payload.results[0], { ...payload.results[0] }, { ...payload.results[0] }];
    const body = JSON.stringify(payload);
    const reserve = vi.fn().mockResolvedValue({ minuteRemaining: 1, dailyResultsRemaining: 1 });

    await handleRunIngestRequest(request(body, signed(body)), dependencies(vi.fn(), 1, reserve));

    // Counting requests alone would let one workflow write hundreds of rows
    // while appearing to stay inside its quota.
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, resultCount: 3 }),
    );
  });

  it("fails closed when the quota limiter is unavailable", async () => {
    withSecret();
    const body = JSON.stringify(validPayload());
    const ingest = vi.fn();

    const response = await handleRunIngestRequest(
      request(body, signed(body)),
      dependencies(ingest, 1, async () => {
        throw new Error("redis unreachable");
      }),
    );

    expect(response.status).toBe(503);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("rejects a body altered after signing", async () => {
    withSecret();
    const body = JSON.stringify(validPayload());
    const signature = signed(body);
    const tampered = JSON.stringify(validPayload({ projectId: OTHER_PROJECT }));
    const ingest = vi.fn();

    const response = await handleRunIngestRequest(request(tampered, signature), dependencies(ingest));

    expect(response.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("rejects an unsigned request", async () => {
    withSecret();
    const body = JSON.stringify(validPayload());
    const ingest = vi.fn();

    const response = await handleRunIngestRequest(request(body, null), dependencies(ingest));

    expect(response.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("rejects a malformed payload before verifying anything", async () => {
    withSecret();
    const body = JSON.stringify({ organizationId: "not-a-uuid", results: [] });
    const ingest = vi.fn();

    const response = await handleRunIngestRequest(request(body, signed(body)), dependencies(ingest));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_payload" });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    withSecret();
    const ingest = vi.fn();

    const response = await handleRunIngestRequest(request("{not json", "sha256=" + "0".repeat(64)), dependencies(ingest));

    expect(response.status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("fails closed when the server secret is not configured", async () => {
    vi.stubEnv("RUNNER_INGEST_SECRET", "");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const body = JSON.stringify(validPayload());
    const ingest = vi.fn();

    const response = await handleRunIngestRequest(request(body, signed(body)), dependencies(ingest));

    expect(response.status).toBe(503);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("maps domain errors to their status without leaking details", async () => {
    withSecret();
    const body = JSON.stringify(validPayload());
    const ingest = vi.fn().mockRejectedValue(new RunIngestError("repository_connection_inactive", 403));

    const response = await handleRunIngestRequest(request(body, signed(body)), dependencies(ingest));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "repository_connection_inactive" });
  });

  it("returns a generic failure for unexpected errors", async () => {
    withSecret();
    const body = JSON.stringify(validPayload());
    const ingest = vi.fn().mockRejectedValue(new Error("connection string postgres://user:pw@host/db"));

    const response = await handleRunIngestRequest(request(body, signed(body)), dependencies(ingest));

    expect(response.status).toBe(500);
    const payload = await response.text();
    expect(payload).toContain("ingest_failed");
    expect(payload).not.toContain("postgres://");
  });
});
