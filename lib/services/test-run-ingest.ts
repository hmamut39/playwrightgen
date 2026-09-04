import "server-only";

import { z } from "zod";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { readTestCaseVersionMarker } from "@/lib/integrations/runner/ingest-token";

/**
 * Ingest for test results produced by the customer's own CI.
 *
 * PlaywrightGen never executes repository code. The customer's GitHub Actions
 * workflow runs Playwright against their own infrastructure and posts a bounded
 * summary here. That keeps the sandbox, egress, and tenant-isolation problems in
 * `docs/GITHUB_AND_RUNNER_ARCHITECTURE.md` out of scope entirely: there is no
 * PlaywrightGen-operated runner to escape from.
 *
 * Authorization is proven before this service is called, by verifying an HMAC
 * over the exact raw body with the project's derived ingest token. This service
 * therefore trusts the tenant identity it is given but still scopes every query
 * by organizationId and projectId so a payload cannot reach another tenant's
 * rows.
 */

const uuidSchema = z.string().uuid();

const resultStatusSchema = z.enum([
  "passed",
  "failed",
  "timedOut",
  "skipped",
  "interrupted",
]);

export const ingestPayloadSchema = z.object({
  organizationId: uuidSchema,
  projectId: uuidSchema,
  run: z.object({
    provider: z.literal("github_actions"),
    externalId: z.string().trim().min(1).max(200),
    url: z.string().trim().url().max(2_000),
    commitSha: z.string().trim().regex(/^[0-9a-f]{40}$/i),
    ref: z.string().trim().min(1).max(300),
  }),
  environment: z.enum(["LOCAL", "DEVELOPMENT", "STAGING", "PRODUCTION", "OTHER"]),
  browser: z.enum(["NONE", "CHROMIUM", "FIREFOX", "WEBKIT"]),
  baseUrl: z.string().trim().url().max(2_000).nullable().optional(),
  results: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(500),
        status: resultStatusSchema,
        durationMs: z.number().int().nonnegative().max(2_147_483_647).optional(),
        errorMessage: z.string().trim().max(20_000).optional(),
        steps: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(500),
              status: resultStatusSchema,
            }),
          )
          .max(200)
          .optional(),
      }),
    )
    .min(1)
    .max(500),
});

export type IngestPayload = z.infer<typeof ingestPayloadSchema>;

export class RunIngestError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;

  constructor(code: string, status: 400 | 403 | 404 | 409) {
    super(code);
    this.name = "RunIngestError";
    this.code = code;
    this.status = status;
  }
}

function toResult(status: z.infer<typeof resultStatusSchema>) {
  if (status === "passed") return "PASSED" as const;
  if (status === "skipped" || status === "interrupted") return "BLOCKED" as const;
  return "FAILED" as const;
}

function toStepResult(status: z.infer<typeof resultStatusSchema>) {
  if (status === "passed") return "PASSED" as const;
  if (status === "skipped" || status === "interrupted") return "SKIPPED" as const;
  return "FAILED" as const;
}

export type IngestSummary = {
  recorded: number;
  duplicates: number;
  unmatched: number;
};

/**
 * Resolves the actor a CI-recorded attempt is attributed to. Automated runs have
 * no Clerk session, so attempts are attributed to the human who connected the
 * repository. That keeps `executedByUserId` a real, auditable user rather than a
 * synthetic account, and it fails closed when no connection is active.
 */
async function resolveAutomationActor(
  prisma: PrismaClient,
  organizationId: string,
  projectId: string,
): Promise<string> {
  const connection = await prisma.repositoryConnection.findFirst({
    where: { organizationId, projectId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { createdByUserId: true },
  });

  if (!connection) throw new RunIngestError("repository_connection_inactive", 403);
  return connection.createdByUserId;
}

export async function ingestPlaywrightResults(
  payload: IngestPayload,
  dependencies?: { prisma?: PrismaClient },
): Promise<IngestSummary> {
  const prisma = dependencies?.prisma ?? getPrismaClient();
  const { organizationId, projectId } = payload;

  const project = await prisma.project.findFirst({
    where: { organizationId, id: projectId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!project) throw new RunIngestError("project_not_found", 404);

  const actorUserId = await resolveAutomationActor(prisma, organizationId, projectId);

  const summary: IngestSummary = { recorded: 0, duplicates: 0, unmatched: 0 };

  for (const entry of payload.results) {
    const testCaseVersionId = readTestCaseVersionMarker(entry.title);
    if (!testCaseVersionId) {
      summary.unmatched += 1;
      continue;
    }

    const version = await prisma.testCaseVersion.findFirst({
      where: { organizationId, projectId, id: testCaseVersionId },
      select: { id: true, testCaseId: true },
    });
    if (!version) {
      summary.unmatched += 1;
      continue;
    }

    const evidenceLabel = `CI run ${payload.run.externalId}`;
    const recordedNow = await prisma.$transaction(async (transaction) => {
      const existingRun = await transaction.testRun.findFirst({
        where: {
          organizationId,
          projectId,
          testCaseId: version.testCaseId,
          testCaseVersionId: version.id,
          mode: "PLAYWRIGHT_BROWSER",
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, latestAttemptNumber: true, status: true },
      });

      const testRun =
        existingRun ??
        (await transaction.testRun.create({
          data: {
            organizationId,
            projectId,
            testCaseId: version.testCaseId,
            testCaseVersionId: version.id,
            name: entry.title.slice(0, 300),
            status: "NOT_STARTED",
            mode: "PLAYWRIGHT_BROWSER",
            environment: payload.environment,
            browser: payload.browser,
            baseUrl: payload.baseUrl ?? null,
            createdByUserId: actorUserId,
          },
          select: { id: true, latestAttemptNumber: true, status: true },
        }));

      if (testRun.status === "CANCELED") return false;

      // Idempotency: the same workflow run must not create a second attempt.
      // The conditional update below serializes concurrent deliveries for the
      // same Test Run, so a duplicate either matches here or loses that update.
      const duplicate = await transaction.testRunAttempt.findFirst({
        where: {
          organizationId,
          projectId,
          testRunId: testRun.id,
          evidence: {
            array_contains: [
              { kind: "LINK", label: evidenceLabel, url: payload.run.url },
            ],
          },
        },
        select: { id: true },
      });
      if (duplicate) return false;

      const attemptNumber = testRun.latestAttemptNumber + 1;
      const result = toResult(entry.status);

      const updated = await transaction.testRun.updateMany({
        where: {
          organizationId,
          projectId,
          id: testRun.id,
          status: { not: "CANCELED" },
          latestAttemptNumber: testRun.latestAttemptNumber,
        },
        data: { status: result, latestAttemptNumber: attemptNumber },
      });
      if (updated.count !== 1) throw new RunIngestError("test_run_attempt_conflict", 409);

      const attempt = await transaction.testRunAttempt.create({
        data: {
          organizationId,
          projectId,
          testRunId: testRun.id,
          attemptNumber,
          result,
          mode: "PLAYWRIGHT_BROWSER",
          environment: payload.environment,
          browser: payload.browser,
          baseUrl: payload.baseUrl ?? null,
          durationMs: entry.durationMs ?? null,
          summary: `${payload.run.ref} @ ${payload.run.commitSha.slice(0, 8)}`,
          failureDetails: entry.errorMessage ?? "",
          stepResults: (entry.steps ?? []).map((step, stepIndex) => ({
            stepIndex,
            result: toStepResult(step.status),
            notes: step.title.slice(0, 5_000),
          })) as Prisma.InputJsonValue,
          evidence: [
            { kind: "LINK", label: evidenceLabel, url: payload.run.url },
          ] as Prisma.InputJsonValue,
          executedByUserId: actorUserId,
        },
        select: { id: true },
      });

      await transaction.activity.create({
        data: {
          organizationId,
          projectId,
          actorUserId,
          source: "SYSTEM",
          action: "TEST_RUN_ATTEMPT_RECORDED",
          targetType: "TEST_RUN_ATTEMPT",
          targetId: attempt.id,
          metadata: {
            testRunId: testRun.id,
            attemptNumber,
            result,
            mode: "PLAYWRIGHT_BROWSER",
            provider: payload.run.provider,
            commitSha: payload.run.commitSha,
          },
        },
      });

      return true;
    });

    if (recordedNow) summary.recorded += 1;
    else summary.duplicates += 1;
  }

  return summary;
}
