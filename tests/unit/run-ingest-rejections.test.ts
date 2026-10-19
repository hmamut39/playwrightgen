import { createHmac } from "node:crypto";

import type { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleRunIngestRequest } from "@/app/api/runs/ingest/route";
import {
  deriveProjectRunnerToken,
  verifyRunnerSignature,
} from "@/lib/integrations/runner/ingest-token";
import { RunIngestError } from "@/lib/services/test-run-ingest";

const SECRET = "runner-ingest-secret-for-tests-long-enough";
const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

/**
 * A delivery that arrives and is turned away.
 *
 * A project token is rotated here and the pipeline keeps sending the old one:
 * every request refused, nothing recorded, and a page saying no results have
 * arrived. The refusal must stand -- an old token writes no evidence, ever --
 * while the project still learns that something came and why it was refused.
 *
 * The security line these tests hold: only a caller who proves possession of a
 * real token for this project leaves a trace. Anything else is refused in
 * exactly the way it was before, with nothing written and nothing revealed.
 */
describe("a delivery that is refused", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function withSecret() {
    vi.stubEnv("RUNNER_INGEST_SECRET", SECRET);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  }

  function payload(overrides: Record<string, unknown> = {}) {
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
      results: [{ title: "checkout succeeds", status: "passed", durationMs: 1200 }],
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

  function signedWith(body: string, tokenVersion: number) {
    const token = deriveProjectRunnerToken({
      secret: SECRET,
      organizationId: ORG,
      projectId: PROJECT,
      tokenVersion,
    });
    return `sha256=${createHmac("sha256", token).update(body, "utf8").digest("hex")}`;
  }

  function dependencies(overrides: Record<string, unknown> = {}) {
    return {
      deriveToken: deriveProjectRunnerToken,
      // The real verifier, so a rotated token really fails rather than being
      // waved through by a stub.
      verifySignature: verifyRunnerSignature,
      loadTokenVersion: async () => 3,
      reserve: async () => ({ minuteRemaining: 59, dailyResultsRemaining: 19_999 }),
      ingest: vi.fn().mockResolvedValue({ recorded: 1, duplicates: 0, unmatched: 0 }),
      recordRejection: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("refuses a token from before a rotation, and says which problem it is", async () => {
    withSecret();
    const body = JSON.stringify(payload());
    const recordRejection = vi.fn().mockResolvedValue(undefined);
    const ingest = vi.fn();

    // Current version is 3; the pipeline is still signing with version 2.
    const response = await handleRunIngestRequest(
      request(body, signedWith(body, 2)),
      dependencies({ recordRejection, ingest }),
    );

    // Still refused. An old token must never write evidence.
    expect(response.status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();

    const json = await response.json();
    expect(json.code).toBe("stale_token");
    expect(json.message).toContain("no longer current");
    expect(json.message).toContain("PLAYWRIGHTGEN_TOKEN");

    expect(recordRejection).toHaveBeenCalledTimes(1);
    expect(recordRejection.mock.calls[0][0]).toMatchObject({
      organizationId: ORG,
      projectId: PROJECT,
      reason: "stale_token",
      provider: "github_actions",
      ref: "main",
      total: 1,
    });
  });

  it("writes nothing and says nothing for a signature that was never valid", async () => {
    withSecret();
    const body = JSON.stringify(payload());
    const recordRejection = vi.fn().mockResolvedValue(undefined);

    const response = await handleRunIngestRequest(
      request(body, `sha256=${"0".repeat(64)}`),
      dependencies({ recordRejection }),
    );

    // Indistinguishable from before: no record, no explanation, no hint that
    // this organization and project exist.
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("invalid_signature");
    expect(recordRejection).not.toHaveBeenCalled();
  });

  it("does not reach back further than the recent versions", async () => {
    withSecret();
    const body = JSON.stringify(payload());
    const recordRejection = vi.fn().mockResolvedValue(undefined);

    // Current version 20, signed with version 1: far older than the lookback.
    const response = await handleRunIngestRequest(
      request(body, signedWith(body, 1)),
      dependencies({ recordRejection, loadTokenVersion: async () => 20 }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("invalid_signature");
    expect(recordRejection).not.toHaveBeenCalled();
  });

  /**
   * The advice here changed on 2026-10-19. It used to say "Reconnect the
   * repository", which was the only way to be attributable at the time, and
   * was therefore useless to a team whose code is not on GitHub -- the ones
   * most likely to meet this refusal. Taking the project's CI token now
   * records who did it, so the note names both routes and fits whoever is
   * reading it.
   */
  it("explains a valid token with nobody to attribute evidence to", async () => {
    withSecret();
    const body = JSON.stringify(payload());
    const recordRejection = vi.fn().mockResolvedValue(undefined);
    const ingest = vi.fn().mockRejectedValue(
      new RunIngestError("repository_connection_inactive", 403),
    );

    const response = await handleRunIngestRequest(
      request(body, signedWith(body, 3)),
      dependencies({ recordRejection, ingest }),
    );

    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.code).toBe("repository_connection_inactive");
    // Both routes, because only one of them is open to a GitLab team.
    expect(json.message).toMatch(/reconnect the repository/i);
    expect(json.message).toMatch(/copy the CI token/i);
    // And it says what taking either one actually does, rather than leaving
    // somebody to guess why it would help.
    expect(json.message).toMatch(/recorded as the person the results belong to/i);
    expect(recordRejection).toHaveBeenCalledTimes(1);
    expect(recordRejection.mock.calls[0][0]).toMatchObject({ reason: "connection_inactive" });
  });

  it("still refuses when the refusal could not be recorded", async () => {
    withSecret();
    const body = JSON.stringify(payload());
    // Explaining a refusal must never be able to turn it into a 500: the
    // refusal is the point and it stands either way.
    const recordRejection = vi.fn().mockRejectedValue(new Error("database is down"));

    const response = await handleRunIngestRequest(
      request(body, signedWith(body, 2)),
      dependencies({ recordRejection }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("stale_token");
  });

  it("leaves a first-version project with nothing to look back at", async () => {
    withSecret();
    const body = JSON.stringify(payload());
    const recordRejection = vi.fn().mockResolvedValue(undefined);

    const response = await handleRunIngestRequest(
      request(body, `sha256=${"1".repeat(64)}`),
      dependencies({ recordRejection, loadTokenVersion: async () => 1 }),
    );

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("invalid_signature");
    expect(recordRejection).not.toHaveBeenCalled();
  });
});
