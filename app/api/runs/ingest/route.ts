import { NextRequest } from "next/server";

import {
  EnvironmentValidationError,
  validateRunnerIngestEnvironment,
} from "@/lib/env";
import {
  deriveProjectRunnerToken,
  verifyRunnerSignature,
} from "@/lib/integrations/runner/ingest-token";
import { createWebhookResponder } from "@/lib/operations/webhook-telemetry";
import {
  ingestPayloadSchema,
  ingestPlaywrightResults,
  RunIngestError,
} from "@/lib/services/test-run-ingest";

export const runtime = "nodejs";

const MAX_INGEST_BYTES = 2_000_000;
const SIGNATURE_HEADER = "x-playwrightgen-signature";

type RunIngestRouteDependencies = {
  deriveToken: typeof deriveProjectRunnerToken;
  verifySignature: typeof verifyRunnerSignature;
  ingest: typeof ingestPlaywrightResults;
};

const defaultDependencies: RunIngestRouteDependencies = {
  deriveToken: deriveProjectRunnerToken,
  verifySignature: verifyRunnerSignature,
  ingest: ingestPlaywrightResults,
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
  const errorResponse = (code: string, status: number) =>
    responder.json({ status: "error", code }, { status, code });

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

  const token = dependencies.deriveToken({
    secret: ingestSecret,
    organizationId: payload.data.organizationId,
    projectId: payload.data.projectId,
  });

  const verified = dependencies.verifySignature({
    token,
    rawBody,
    signature: request.headers.get(SIGNATURE_HEADER),
  });
  if (!verified) return errorResponse("invalid_signature", 401);

  try {
    const summary = await dependencies.ingest(payload.data);
    return responder.json(
      { status: "ok", ...summary },
      { status: 200, code: "recorded" },
    );
  } catch (error: unknown) {
    if (error instanceof RunIngestError) {
      return errorResponse(error.code, error.status);
    }
    return errorResponse("ingest_failed", 500);
  }
}

export async function POST(request: NextRequest) {
  return handleRunIngestRequest(request);
}
