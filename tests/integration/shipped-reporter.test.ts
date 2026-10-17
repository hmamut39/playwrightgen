import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `after()` needs a request scope this harness cannot give it. What it
 * schedules -- the pull-request note and the failure analysis -- has its own
 * tests; what matters here is the response the runner is waiting for.
 */
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (callback: () => unknown) => void callback };
});

import { handleRunIngestRequest } from "@/app/api/runs/ingest/route";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  buildTestCaseVersionMarker,
  deriveProjectRunnerToken,
  verifyRunnerSignature,
} from "@/lib/integrations/runner/ingest-token";
import { ingestPlaywrightResults } from "@/lib/services/test-run-ingest";
import { approveTestCase, createTestCase, submitTestCaseForReview } from "@/lib/services/test-cases";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

/**
 * The file a customer commits, run against the endpoint it posts to.
 *
 * Everything either side of this seam is tested and the seam itself was not.
 * `templates/github-actions/playwrightgen-report.mjs` is plain Node that
 * executes on somebody else's runner; the ingest route is TypeScript here.
 * Nothing checked that the payload one builds is the payload the other
 * accepts, so a renamed field, a changed signature scheme or a stricter
 * schema would be discovered by a stranger whose first push silently records
 * nothing -- the one moment a new team decides whether this product works.
 *
 * So this runs the shipped reporter as a child process, exactly as a pipeline
 * does: a Playwright JSON report on disk, the environment variables the
 * workflow sets, and a real HTTP request to the real handler over a loopback
 * socket. The only things injected are the pieces that would reach outside
 * the test -- the rate limiter, the pull-request note, the failure analysis.
 */
const repositoryRoot = resolve(__dirname, "..", "..");
const REPORTER = join(repositoryRoot, "templates", "github-actions", "playwrightgen-report.mjs");
const unique = (prefix: string) => `${prefix}-${randomUUID()}`;
const numericId = () => String(Math.floor(Math.random() * 1_000_000_000) + 1);

/** A Playwright JSON report with one spec, shaped as Playwright writes it. */
function playwrightReport(title: string, status: "passed" | "failed") {
  return {
    config: { rootDir: "/runner/tests" },
    suites: [
      {
        title: "home.spec.ts",
        specs: [
          {
            title,
            tests: [
              {
                results: [
                  {
                    status,
                    duration: 1234.6,
                    ...(status === "failed"
                      ? { error: { message: "expect(locator).toBeVisible() failed" } }
                      : {}),
                    steps: [
                      { title: "open the page" },
                      ...(status === "failed" ? [{ title: "see the heading", error: { message: "no" } }] : []),
                    ],
                    attachments: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("the reporter a customer commits, against the endpoint it posts to", () => {
  let prisma: PrismaClient;
  let server: Server;
  let endpoint = "";
  const originalSecret = process.env.RUNNER_INGEST_SECRET;
  /** Every request the reporter made, so a refusal can be read as one. */
  const seen: Array<{ status: number; body: string }> = [];

  beforeAll(async () => {
    process.env.RUNNER_INGEST_SECRET = originalSecret?.trim() ? originalSecret : `test-${randomUUID()}`;
    prisma = createTestPrismaClient();
    await connectTestDatabase(prisma);

    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        void (async () => {
          // Always answers. The reporter waits on this socket, so an error
          // here that left it unanswered would hang the whole suite instead
          // of failing one test -- which is what the first run of this file
          // did.
          try {
            const body = Buffer.concat(chunks).toString("utf8");
            const headers = new Headers();
            for (const [name, value] of Object.entries(request.headers)) {
              if (typeof value === "string") headers.set(name, value);
            }
            const result = await handleRunIngestRequest(
              new NextRequest(`http://127.0.0.1${request.url ?? "/"}`, { method: "POST", headers, body }),
              {
                deriveToken: deriveProjectRunnerToken,
                verifySignature: verifyRunnerSignature,
                loadTokenVersion: async (organizationId, projectId) =>
                  (
                    await prisma.project.findFirst({
                      where: { organizationId, id: projectId },
                      select: { runnerTokenVersion: true },
                    })
                  )?.runnerTokenVersion ?? null,
                // Reaches Redis otherwise, which this seam is not about.
                reserve: async () => ({ remaining: 100 }) as never,
                ingest: (payload) => ingestPlaywrightResults(payload, { prisma }),
                notePullRequest: async () => undefined as never,
                analyzeFailures: async () => undefined as never,
              },
            );
            const text = await result.text();
            seen.push({ status: result.status, body: text });
            response.writeHead(result.status, { "content-type": "application/json" });
            response.end(text);
          } catch (error) {
            const message = error instanceof Error ? `${error.message}` : String(error);
            seen.push({ status: 500, body: `handler threw: ${message}` });
            response.writeHead(500, { "content-type": "application/json" });
            response.end(JSON.stringify({ status: "error", message }));
          }
        })();
      });
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected a port");
    endpoint = `http://127.0.0.1:${address.port}`;
  }, 60_000);

  beforeEach(async () => {
    seen.length = 0;
    await cleanPhase1ATables(prisma);
  });

  afterAll(async () => {
    if (originalSecret === undefined) delete process.env.RUNNER_INGEST_SECRET;
    else process.env.RUNNER_INGEST_SECRET = originalSecret;
    await new Promise<void>((closed) => server.close(() => closed()));
    if (prisma) {
      await cleanPhase1ATables(prisma);
      await disconnectTestDatabase(prisma);
    }
  });

  async function workspace() {
    const owner = await prisma.user.create({ data: { clerkUserId: unique("owner"), displayName: "Owner" } });
    const organization = await prisma.organization.create({
      data: { clerkOrganizationId: unique("org"), name: "Reporter", slug: unique("reporter") },
    });
    await prisma.membership.create({
      data: { organizationId: organization.id, userId: owner.id, role: "OWNER" },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: organization.id,
        name: "Checkout",
        slug: unique("checkout"),
        createdByUserId: owner.id,
      },
    });
    // Results are accepted for a project with a live repository connection
    // and refused otherwise, so the fixture needs one to reach the seam this
    // file is about.
    const installation = await prisma.gitHubInstallation.create({
      data: {
        organizationId: organization.id,
        externalInstallationId: numericId(),
        accountId: "1",
        accountLogin: "acme",
        accountType: "User",
        repositorySelection: "selected",
        connectedByUserId: owner.id,
      },
    });
    await prisma.repositoryConnection.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        githubInstallationId: installation.id,
        externalRepositoryId: numericId(),
        ownerLogin: "acme",
        name: "web",
        fullName: "acme/web",
        defaultBranch: "main",
        visibility: "PUBLIC",
        status: "ACTIVE",
        createdByUserId: owner.id,
      },
    });
    return { owner, organization, project };
  }

  const deps = (space: Awaited<ReturnType<typeof workspace>>) => ({
    authenticate: async () => ({
      userId: space.owner.clerkUserId,
      orgId: space.organization.clerkOrganizationId,
    }),
    prisma,
  });

  /** An approved Test Case, and the marker a generated test carries. */
  async function approved(space: Awaited<ReturnType<typeof workspace>>) {
    const record = await createTestCase(
      {
        projectId: space.project.id,
        title: "A visitor sees the headline",
        objective: "The home page states what the product does.",
        preconditions: "None.",
        steps: ["Open the home page"],
        expectedResults: ["The headline is visible"],
        priority: "MEDIUM",
        type: "END_TO_END",
        tags: [],
      },
      deps(space),
    );
    await submitTestCaseForReview({ projectId: space.project.id, testCaseId: record.id }, deps(space));
    await approveTestCase({ projectId: space.project.id, testCaseId: record.id }, deps(space));
    const version = await prisma.testCaseVersion.findFirstOrThrow({
      where: { testCaseId: record.id },
      orderBy: { versionNumber: "desc" },
      select: { id: true },
    });
    return { testCaseId: record.id, versionId: version.id, marker: buildTestCaseVersionMarker(version.id) };
  }

  /**
   * Runs the shipped reporter the way a pipeline does, and returns its output.
   *
   * Asynchronously, and that is not a style choice: the ingest handler above
   * answers on this same event loop, so a synchronous child blocks the thread
   * that has to serve it and both sides wait until the timeout. The first
   * version of this file did exactly that and five tests hung for thirty
   * seconds each.
   */
  async function runReporter(
    space: Awaited<ReturnType<typeof workspace>>,
    report: unknown,
    overrides: Record<string, string> = {},
  ) {
    const directory = mkdtempSync(join(tmpdir(), "pwg-reporter-"));
    writeFileSync(join(directory, "playwright-report.json"), JSON.stringify(report));
    const summaryFile = join(directory, "step-summary.md");
    writeFileSync(summaryFile, "");

    const { stdout } = await promisify(execFile)(process.execPath, [REPORTER], {
      cwd: directory,
      encoding: "utf8",
      // A reporter that never returns must fail this test rather than hang it.
      timeout: 30_000,
      env: {
        ...process.env,
        PLAYWRIGHTGEN_TOKEN: deriveProjectRunnerToken({
          secret: process.env.RUNNER_INGEST_SECRET as string,
          organizationId: space.organization.id,
          projectId: space.project.id,
          tokenVersion: 1,
        }),
        PLAYWRIGHTGEN_ORG_ID: space.organization.id,
        PLAYWRIGHTGEN_PROJECT_ID: space.project.id,
        PLAYWRIGHTGEN_URL: endpoint,
        RUN_ID: "9001-1",
        RUN_URL: "https://github.com/acme/web/actions/runs/9001",
        COMMIT_SHA: "a".repeat(40),
        REF_NAME: "main",
        GITHUB_STEP_SUMMARY: summaryFile,
        ...overrides,
      },
    });
    return { stdout, summary: readFileSync(summaryFile, "utf8") };
  }

  it("records a marked result as evidence, and says so where the pipeline shows it", async () => {
    const space = await workspace();
    const { testCaseId, versionId, marker } = await approved(space);

    const { stdout, summary } = await runReporter(space, playwrightReport(`${marker} a visitor sees the headline`, "passed"));

    expect(seen).toHaveLength(1);
    expect(seen[0], seen[0]?.body).toMatchObject({ status: 200 });
    // The sentence the project page shows, in the CI log and on the summary.
    expect(stdout).toContain("Recorded 1 of 1 result");
    expect(summary).toContain("**PlaywrightGen**");
    expect(summary).toContain("Recorded 1 of 1 result");

    const attempt = await prisma.testRunAttempt.findFirstOrThrow({
      where: { projectId: space.project.id },
      select: { result: true, durationMs: true, testRun: { select: { testCaseId: true, testCaseVersionId: true } } },
    });
    expect(attempt.result).toBe("PASSED");
    // Rounded from Playwright's fractional milliseconds, not dropped.
    expect(attempt.durationMs).toBe(1235);
    expect(attempt.testRun.testCaseId).toBe(testCaseId);
    expect(attempt.testRun.testCaseVersionId).toBe(versionId);
  }, 60_000);

  it("carries a failure's message and steps through to the attempt", async () => {
    const space = await workspace();
    const { marker } = await approved(space);

    await runReporter(space, playwrightReport(`${marker} a visitor sees the headline`, "failed"));

    expect(seen[0], seen[0]?.body).toMatchObject({ status: 200 });
    const attempt = await prisma.testRunAttempt.findFirstOrThrow({
      where: { projectId: space.project.id },
      select: { result: true, failureDetails: true, stepResults: true },
    });
    expect(attempt.result).toBe("FAILED");
    expect(attempt.failureDetails).toContain("toBeVisible() failed");
    // Stored in the shape the workspace reads, not the shape the reporter
    // sent: this translation is half of what the seam does.
    expect(attempt.stepResults).toEqual([
      { stepIndex: 0, notes: "open the page", result: "PASSED" },
      { stepIndex: 1, notes: "see the heading", result: "FAILED" },
    ]);
  }, 60_000);

  it("names the provider the pipeline says it is", async () => {
    const space = await workspace();
    const { marker } = await approved(space);

    await runReporter(space, playwrightReport(`${marker} a visitor sees the headline`, "passed"), {
      PLAYWRIGHTGEN_PROVIDER: "gitlab_ci",
      GITHUB_STEP_SUMMARY: "",
    });

    expect(seen[0], seen[0]?.body).toMatchObject({ status: 200 });
    // Which CI it came from lives on the append-only trail, where a reviewer
    // reading an attempt months later can still find it.
    const delivered = await prisma.activity.findFirstOrThrow({
      where: { projectId: space.project.id, action: "CI_RESULTS_DELIVERED" },
      select: { metadata: true },
    });
    expect(delivered.metadata).toMatchObject({ provider: "gitlab_ci" });
  }, 60_000);

  it("reports an unmarked test as recording nothing, rather than as an error", async () => {
    const space = await workspace();
    await approved(space);

    const { stdout, summary } = await runReporter(space, playwrightReport("a visitor sees the headline", "passed"));

    expect(seen[0], seen[0]?.body).toMatchObject({ status: 200 });
    // The product's own sentence, which explains the silence rather than
    // reporting a zero: the same words the project page shows.
    expect(stdout).toContain("The one result was not recorded.");
    expect(stdout).toContain("[pwg:");
    expect(summary).toContain("was not recorded");
    expect(await prisma.testRunAttempt.count({ where: { projectId: space.project.id } })).toBe(0);
  }, 60_000);

  it("does not fail the pipeline when the token is wrong, and says why", async () => {
    const space = await workspace();
    const { marker } = await approved(space);

    // Exit code zero is the contract: reporting is observability, and a
    // rejected delivery must never turn a green suite red.
    const { stdout, summary } = await runReporter(space, playwrightReport(`${marker} x`, "passed"), {
      PLAYWRIGHTGEN_TOKEN: "pwgr_not_the_token",
    });

    expect(seen[0].status).toBe(401);
    expect(stdout).toMatch(/could not record this run/i);
    expect(summary).toMatch(/could not record this run/i);
    expect(await prisma.testRunAttempt.count({ where: { projectId: space.project.id } })).toBe(0);
  }, 60_000);

  it("says nothing happened when there are no tests yet", async () => {
    const space = await workspace();
    await approved(space);

    const { stdout, summary } = await runReporter(space, { config: {}, suites: [] });

    // A first push, before anything has been generated: the pipeline worked
    // and there was nothing to report. Nothing is sent at all.
    expect(seen).toHaveLength(0);
    expect(stdout).toContain("no tests ran");
    expect(summary).toContain("no tests ran");
  }, 60_000);
});
