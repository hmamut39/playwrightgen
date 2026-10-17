import { after, NextRequest } from "next/server";

import { deliveryNote, rejectionNote } from "@/lib/ci/delivery-note";
import { getPrismaClient } from "@/lib/db/prisma";
import {
  EnvironmentValidationError,
  validateRunnerIngestEnvironment,
} from "@/lib/env";
import {
  deriveProjectRunnerToken,
  verifyRunnerSignature,
} from "@/lib/integrations/runner/ingest-token";
import { analyzeReportedFailures } from "@/lib/operations/auto-failure-analysis";
import { notePullRequest } from "@/lib/services/ci-pull-request-note";
import { recordCiRejection } from "@/lib/services/ci-rejections";
import {
  reserveRunIngest,
  RunIngestRateLimitError,
} from "@/lib/operations/run-ingest-guard";
import { createWebhookResponder } from "@/lib/operations/webhook-telemetry";
import {
  ingestPayloadSchema,
  ingestPlaywrightResults,
  RunIngestError,
} from "@/lib/services/test-run-ingest";

export const runtime = "nodejs";

const MAX_INGEST_BYTES = 2_000_000;

/**
 * How many previous token versions a refused signature is checked against.
 *
 * Enough to recognise a pipeline that is still sending the token from before
 * a rotation -- which is the common reason results stop arriving -- without
 * accepting anything: an old token still fails. Rotations are rare, so a
 * handful covers every realistic case, and each check is one HMAC on a body
 * whose signature has already been found wanting.
 */
const STALE_TOKEN_LOOKBACK = 5;
const SIGNATURE_HEADER = "x-playwrightgen-signature";

type RunIngestRouteDependencies = {
  deriveToken: typeof deriveProjectRunnerToken;
  verifySignature: typeof verifyRunnerSignature;
  loadTokenVersion: (organizationId: string, projectId: string) => Promise<number | null>;
  reserve: typeof reserveRunIngest;
  ingest: typeof ingestPlaywrightResults;
  recordRejection?: typeof recordCiRejection;
  notePullRequest?: typeof notePullRequest;
  analyzeFailures?: typeof analyzeReportedFailures;
};

/** The recent previous versions of a project token, newest first. */
function recentVersions(current: number): number[] {
  const versions: number[] = [];
  for (let version = current - 1; version >= 1 && versions.length < STALE_TOKEN_LOOKBACK; version -= 1) {
    versions.push(version);
  }
  return versions;
}

/**
 * Reads the project's current token version, which the derivation depends on so
 * a rotated token stops verifying. Returns null when no such project exists for
 * that organization, which the caller treats exactly like a bad signature.
 */
async function loadProjectTokenVersion(
  organizationId: string,
  projectId: string,
): Promise<number | null> {
  const project = await getPrismaClient().project.findFirst({
    where: { organizationId, id: projectId },
    select: { runnerTokenVersion: true },
  });
  return project?.runnerTokenVersion ?? null;
}

const defaultDependencies: RunIngestRouteDependencies = {
  deriveToken: deriveProjectRunnerToken,
  verifySignature: verifyRunnerSignature,
  loadTokenVersion: loadProjectTokenVersion,
  reserve: reserveRunIngest,
  ingest: ingestPlaywrightResults,
  recordRejection: recordCiRejection,
  notePullRequest,
  analyzeFailures: analyzeReportedFailures,
};

/**
 * Accepts Playwright results produced by a customer's own CI.
 *
 * The tenant identity in the body is untrusted until the HMAC over the exact raw
 * body verifies against the token derived for that same tenant. A payload naming
 * another organization therefore cannot be signed without that organization's
 * token, and the body is never parsed as authority before verification.
 */
export async function handleRunIngestRequest(
  request: NextRequest,
  dependencies: RunIngestRouteDependencies = defaultDependencies,
) {
  const responder = createWebhookResponder("runs-ingest");
  const errorResponse = (code: string, status: number, message?: string) =>
    responder.json(
      message ? { status: "error", code, message } : { status: "error", code },
      { status, code },
    );

  let ingestSecret: string;
  try {
    ingestSecret = validateRunnerIngestEnvironment().RUNNER_INGEST_SECRET;
  } catch (error: unknown) {
    if (error instanceof EnvironmentValidationError) {
      return errorResponse("configuration_unavailable", 503);
    }
    throw error;
  }

  const rawBody = await request.text();
  if (rawBody.length === 0) return errorResponse("empty_body", 400);
  if (Buffer.byteLength(rawBody, "utf8") > MAX_INGEST_BYTES) {
    return errorResponse("payload_too_large", 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return errorResponse("invalid_json", 400);
  }

  const payload = ingestPayloadSchema.safeParse(parsed);
  if (!payload.success) return errorResponse("invalid_payload", 400);

  const tokenVersion = await dependencies.loadTokenVersion(
    payload.data.organizationId,
    payload.data.projectId,
  );
  // A missing project is reported as an invalid signature rather than 404, so an
  // unauthenticated caller cannot probe which organization and project pairs
  // exist by watching the status code change.
  if (tokenVersion === null) return errorResponse("invalid_signature", 401);

  const token = dependencies.deriveToken({
    secret: ingestSecret,
    organizationId: payload.data.organizationId,
    projectId: payload.data.projectId,
    tokenVersion,
  });

  const verified = dependencies.verifySignature({
    token,
    rawBody,
    signature: request.headers.get(SIGNATURE_HEADER),
  });
  if (!verified) {
    // A pipeline still holding the token from before a rotation is the
    // common reason results stop arriving, and it looks identical to an
    // attack from here. Checking the recent previous versions tells them
    // apart. The delivery is refused either way -- an old token writes
    // nothing -- but a holder of one gets told what to do about it, and the
    // project gets a record that something arrived and was turned away.
    const stale = recentVersions(tokenVersion).some((version) =>
      dependencies.verifySignature({
        token: dependencies.deriveToken({
          secret: ingestSecret,
          organizationId: payload.data.organizationId,
          projectId: payload.data.projectId,
          tokenVersion: version,
        }),
        rawBody,
        signature: request.headers.get(SIGNATURE_HEADER),
      }),
    );
    if (!stale) return errorResponse("invalid_signature", 401);

    // Recording must never turn a refusal into a server error: the point is
    // to explain the refusal, and the refusal stands regardless.
    await (dependencies.recordRejection ?? recordCiRejection)({
      organizationId: payload.data.organizationId,
      projectId: payload.data.projectId,
      reason: "stale_token",
      provider: payload.data.run.provider,
      externalId: payload.data.run.externalId,
      url: payload.data.run.url,
      ref: payload.data.run.ref,
      commitSha: payload.data.run.commitSha,
      total: payload.data.results.length,
    }).catch(() => {});

    return errorResponse("stale_token", 401, rejectionNote("stale_token"));
  }

  // Quota is reserved only after the signature verifies, so an unauthenticated
  // caller cannot exhaust a tenant's allowance by posting garbage.
  try {
    await dependencies.reserve({
      organizationId: payload.data.organizationId,
      resultCount: payload.data.results.length,
    });
  } catch (error: unknown) {
    if (error instanceof RunIngestRateLimitError) {
      return errorResponse(error.code, 429);
    }
    // Fails closed. Writing unbounded evidence with no working limiter is worse
    // than dropping a report: the reporter exits zero on error, so a customer's
    // suite stays green and the next push retries.
    return errorResponse("ingest_guard_unavailable", 503);
  }

  try {
    const summary = await dependencies.ingest(payload.data);

    // Analysed after the response is sent. CI is waiting on this request, and a
    // model call takes seconds, so making a runner hold the connection open to
    // learn something it does not use would trade a fast webhook for nothing.
    // Defensive: an ingest implementation that reports no failures list must
    // not turn a successful webhook into a 500. The evidence is already stored
    // by this point, and losing the response would make CI retry a delivery
    // that actually succeeded.

    const failures = summary.failures ?? [];
    if (failures.length > 0) {
      const analyze = dependencies.analyzeFailures ?? analyzeReportedFailures;
      after(() => analyze({ ...summary, failures }, payload.data.projectId));
    }

    // The attempt identifiers stay server-side. A runner needs to know what was
    // recorded, not the internal ids of records it cannot read.
    const counts = {
      recorded: summary.recorded,
      duplicates: summary.duplicates,
      unmatched: summary.unmatched,
      unknownVersion: summary.unknownVersion,
      unknownVersionProjects: summary.unknownVersionProjects ?? [],
      skipped: summary.skipped ?? 0,
    };
    // Left on the pull request after the response, for the same reason the
    // analysis is: the runner is waiting, and three GitHub round trips to
    // tell a developer something they will read later is not worth holding
    // the connection for. It states what was recorded and gates nothing.
    if (summary.recordedTestCaseIds?.length) {
      const note = dependencies.notePullRequest ?? notePullRequest;
      after(() =>
        note({
          organizationId: summary.organizationId,
          projectId: payload.data.projectId,
          ref: payload.data.run.ref,
          commitSha: payload.data.run.commitSha,
          provider: payload.data.run.provider,
          counts: { ...counts, total: payload.data.results.length },
          recordedTestCaseIds: summary.recordedTestCaseIds,
        }),
      );
    }

    // The same sentence the project page shows, so a build engineer reading
    // their CI log and a tester reading the page are told the same thing.
    // Three numbers do not explain why a pipeline recorded nothing.
    const message = deliveryNote({ ...counts, total: payload.data.results.length });

    return responder.json(
      { status: "ok", ...counts, message },
      { status: 200, code: "recorded" },
    );
  } catch (error: unknown) {
    if (error instanceof RunIngestError) {
      if (error.code === "repository_connection_inactive") {
        await (dependencies.recordRejection ?? recordCiRejection)({
          organizationId: payload.data.organizationId,
          projectId: payload.data.projectId,
          reason: "connection_inactive",
          provider: payload.data.run.provider,
          externalId: payload.data.run.externalId,
          url: payload.data.run.url,
          ref: payload.data.run.ref,
          commitSha: payload.data.run.commitSha,
          total: payload.data.results.length,
        }).catch(() => {});
        return errorResponse(
          error.code,
          error.status,
          rejectionNote("connection_inactive"),
        );
      }
      return errorResponse(error.code, error.status);
    }
    return errorResponse("ingest_failed", 500);
  }
}

export async function POST(request: NextRequest) {
  return handleRunIngestRequest(request);
}
