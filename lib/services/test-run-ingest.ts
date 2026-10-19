import "server-only";

import { z } from "zod";

import { stripControlSequences } from "@/lib/integrations/runner/ansi";
import { webUrlSchema } from "@/lib/validation/url";

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
    // Widened from GitHub Actions alone. An IT department rarely runs one CI,
    // and a team on GitLab or Jenkins could not report at all before this.
    // The value is recorded with the attempt and grants nothing: the HMAC
    // signature is still what authorizes the write.
    provider: z.enum(["github_actions", "gitlab_ci", "jenkins", "azure_pipelines", "other"]),
    externalId: z.string().trim().min(1).max(200),
    url: webUrlSchema(),
    commitSha: z.string().trim().regex(/^[0-9a-f]{40}$/i),
    ref: z.string().trim().min(1).max(300),
  }),
  environment: z.enum(["LOCAL", "DEVELOPMENT", "STAGING", "PRODUCTION", "OTHER"]),
  browser: z.enum(["NONE", "CHROMIUM", "FIREFOX", "WEBKIT"]),
  baseUrl: webUrlSchema().nullable().optional(),
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
        // Per-test artifacts. A failure that says only "expected true, got
        // false" tells a reviewer that something broke and nothing about what
        // the browser actually did; the trace, screenshot and video are the
        // evidence they need, and Playwright already produces them on every
        // failing test. Links rather than uploads: CI has already stored these
        // somewhere durable, so pointing at them adds no storage, no retention
        // policy and no new place for customer data to sit.
        artifacts: z
          .array(
            z.object({
              kind: z.enum(["TRACE", "SCREENSHOT", "VIDEO", "LOG", "LINK"]),
              label: z.string().trim().min(1).max(200).optional(),
              url: webUrlSchema(),
            }),
          )
          .max(20)
          .optional(),
      }),
    )
    .min(1)
    .max(500),
});

export type IngestPayload = z.infer<typeof ingestPayloadSchema>;

const artifactKindLabel = {
  TRACE: "Trace",
  SCREENSHOT: "Screenshot",
  VIDEO: "Video",
  LOG: "Log",
  LINK: "Link",
} as const;

/**
 * Turns the artifacts reported for one test into evidence entries.
 *
 * Labels are generated when CI does not supply one, and numbered when a test
 * produced several of a kind, because three links all reading "Screenshot" are
 * no more useful to a reviewer than no label at all.
 */
function artifactEvidence(
  artifacts: IngestPayload["results"][number]["artifacts"],
): Array<{ kind: string; label: string; url: string }> {
  if (!artifacts?.length) return [];
  const seen = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const artifact of artifacts) {
    if (artifact.label) continue;
    totals.set(artifact.kind, (totals.get(artifact.kind) ?? 0) + 1);
  }

  return artifacts.map((artifact) => {
    if (artifact.label) {
      return { kind: artifact.kind, label: artifact.label, url: artifact.url };
    }
    const position = (seen.get(artifact.kind) ?? 0) + 1;
    seen.set(artifact.kind, position);
    const base = artifactKindLabel[artifact.kind];
    return {
      kind: artifact.kind,
      label: (totals.get(artifact.kind) ?? 0) > 1 ? `${base} ${position}` : base,
      url: artifact.url,
    };
  });
}

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
  /** Results whose title carried no marker at all. */
  unmatched: number;
  /**
   * Results carrying a marker for a version this project does not have.
   *
   * Counted apart because the two need opposite advice: one says add a
   * marker, the other says the marker is already there and points
   * somewhere else.
   */
  unknownVersion: number;
  /**
   * Projects in this same workspace that do own those versions, named so the
   * delivery can say what is actually wrong.
   *
   * Scoped to the delivering organization and nowhere wider: which projects a
   * workspace has is that workspace's business, and no delivery may learn
   * anything about another tenant.
   */
  unknownVersionProjects: string[];
  /** Recorded results where the test was skipped or interrupted. */
  skipped: number;
  /**
   * Attempts recorded by this delivery that ran and failed, so the caller can
   * analyze them without querying for what it just wrote. Returned rather than
   * analyzed here: ingest answers a signed webhook and must stay fast and
   * side-effect free with respect to the model provider.
   *
   * A skipped test is not among them: it never reached the behaviour, and a
   * paid analysis of why it failed would answer a question nobody asked.
   */
  failures: Array<{ testRunId: string; testRunAttemptId: string }>;
  /**
   * The Test Cases this delivery recorded against.
   *
   * Needed to say which requirements a push touched, which is the one thing
   * about a failing test that a developer's own CI cannot tell them.
   */
  recordedTestCaseIds: string[];
  organizationId: string;
  actorUserId: string;
};

/**
 * Resolves the actor a CI-recorded attempt is attributed to.
 *
 * Automated runs carry no Clerk session, so each attempt is recorded under a
 * real, auditable person rather than a synthetic account, and it fails closed
 * when there is nobody to name.
 *
 * Two people can qualify, in this order. Whoever connected the repository, as
 * before. Otherwise whoever took this project's CI token -- a holder of
 * `repository:connect`, so a lead or an owner, who put it into a pipeline.
 *
 * The second was added on 2026-10-19. Until then the repository connection
 * was the only answer, and a connection cannot exist without a GitHub
 * installation id: a team whose code lives on GitLab or runs through Jenkins
 * could copy the pipeline configuration this product gives them, set every
 * variable, and have every delivery refused with a 403. The panel offered
 * three pipelines and could finish one.
 *
 * Connecting a pipeline is at least as deliberate an act as installing an App
 * once, so this widens who can be named without loosening what being named
 * means.
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
  if (connection) return connection.createdByUserId;

  const project = await prisma.project.findFirst({
    where: { organizationId, id: projectId },
    select: { runnerTokenActorUserId: true },
  });
  if (project?.runnerTokenActorUserId) return project.runnerTokenActorUserId;

  throw new RunIngestError("repository_connection_inactive", 403);
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

  const summary: IngestSummary = {
    recorded: 0,
    duplicates: 0,
    unmatched: 0,
    unknownVersion: 0,
    unknownVersionProjects: [],
    skipped: 0,
    failures: [],
    recordedTestCaseIds: [],
    organizationId,
    actorUserId,
  };

  /** Foreign markers looked up, at most. */
  const UNKNOWN_VERSION_LOOKUPS = 3;
  const unknownVersionIds = new Set<string>();

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
      summary.unknownVersion += 1;
      // Where it does live, which turns "those tests belong to a different
      // project" into something somebody can act on. Bounded: a suite whose
      // every marker is foreign asks the same question once, not two hundred
      // times, and three names answer it.
      if (unknownVersionIds.size < UNKNOWN_VERSION_LOOKUPS) unknownVersionIds.add(testCaseVersionId);
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

      if (testRun.status === "CANCELED") return null;

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
      if (duplicate) return null;

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
          // Stored structurally as well as in the summary: comparing a failure
          // against earlier evidence on the same version needs a queryable
          // revision, not a formatted string.
          commitSha: payload.run.commitSha.toLowerCase(),
          sourceRef: payload.run.ref,
          failureDetails: stripControlSequences(entry.errorMessage ?? ""),
          stepResults: (entry.steps ?? []).map((step, stepIndex) => ({
            stepIndex,
            result: toStepResult(step.status),
            notes: stripControlSequences(step.title).slice(0, 5_000),
          })) as Prisma.InputJsonValue,
          // The workflow link first, then whatever the run captured for this
          // specific test. The workflow link stays the first element because
          // the idempotency check above matches on it.
          evidence: [
            { kind: "LINK", label: evidenceLabel, url: payload.run.url },
            ...artifactEvidence(entry.artifacts),
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

      return { testRunId: testRun.id, testRunAttemptId: attempt.id, result };
    });

    if (recordedNow) {
      summary.recorded += 1;
      if (!summary.recordedTestCaseIds.includes(version.testCaseId)) {
        summary.recordedTestCaseIds.push(version.testCaseId);
      }
      // Only a test that ran and failed. A skipped or interrupted test is an
      // absence, not a failure: asking the model why it failed spends a paid
      // request to be told what the pipeline already said, and attaches an
      // analysis of a failure to a test that never reached the behaviour.
      if (recordedNow.result === "BLOCKED") summary.skipped += 1;
      if (recordedNow.result === "FAILED") {
        summary.failures.push({
          testRunId: recordedNow.testRunId,
          testRunAttemptId: recordedNow.testRunAttemptId,
        });
      }
    } else summary.duplicates += 1;
  }

  // The delivery itself, recorded whether or not it recorded anything.
  //
  // A team with an existing Playwright suite has no [pwg:...] markers, so
  // their first pipeline run reports hundreds of results and stores none of
  // them. Without this row the Test Runs tab, the activity feed and the
  // project page were all empty, which is exactly what a wrong token looks
  // like too. The counts existed; they were a line of JSON in a CI log.
  //
  // It claims nothing about whether anything passed. It says a pipeline
  // reached here, when, from where, and what became of what it sent.
  /*
   * Which project in this workspace owns the foreign markers.
   *
   * One query, scoped to the delivering organization, because the answer the
   * pipeline needs is "you are reporting to a different project than the one
   * these tests were written in" -- and the product knew that and said only
   * that they "belong to a different PlaywrightGen project". The dogfood
   * repository hit exactly this on 2026-10-17 and the message left nowhere to
   * go. A version that belongs to no project in this workspace is simply not
   * named: it may be another tenant's, and nothing here may say so.
   */
  if (unknownVersionIds.size > 0) {
    const owners = await prisma.testCaseVersion.findMany({
      where: { organizationId, id: { in: [...unknownVersionIds] } },
      select: { projectId: true },
    });
    const owningProjects = await prisma.project.findMany({
      where: { organizationId, id: { in: [...new Set(owners.map((owner) => owner.projectId))] } },
      select: { name: true },
    });
    summary.unknownVersionProjects = [...new Set(owningProjects.map((project) => project.name))];
  }

  await prisma.activity.create({
    data: {
      organizationId,
      projectId,
      actorUserId,
      source: "SYSTEM",
      action: "CI_RESULTS_DELIVERED",
      targetType: "PROJECT",
      targetId: projectId,
      metadata: {
        provider: payload.run.provider,
        externalId: payload.run.externalId,
        url: payload.run.url,
        ref: payload.run.ref,
        commitSha: payload.run.commitSha,
        environment: payload.environment,
        recorded: summary.recorded,
        duplicates: summary.duplicates,
        unmatched: summary.unmatched,
        unknownVersion: summary.unknownVersion,
        unknownVersionProjects: summary.unknownVersionProjects,
        skipped: summary.skipped,
        total: payload.results.length,
      },
    },
  });

  return summary;
}
