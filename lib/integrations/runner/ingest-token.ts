import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const signaturePattern = /^sha256=([0-9a-f]{64})$/;

/**
 * Per-project ingest tokens are derived, not stored. A customer's CI holds the
 * derived value; the control plane recomputes it from the server secret, the
 * tenant identity, and that project's token version. Nothing secret has to be
 * persisted, a leaked token cannot be replayed against a different project
 * because the tenant identity is part of the derivation input, and revocation is
 * local: incrementing one project's version invalidates that project's token
 * without touching any other.
 */
export function deriveProjectRunnerToken(input: {
  secret: string;
  organizationId: string;
  projectId: string;
  tokenVersion: number;
}): string {
  return createHmac("sha256", input.secret)
    .update(
      `pwg:runner:v2:${input.organizationId}:${input.projectId}:${input.tokenVersion}`,
    )
    .digest("base64url");
}

function bodyBuffer(rawBody: string | Uint8Array): Buffer {
  return typeof rawBody === "string"
    ? Buffer.from(rawBody, "utf8")
    : Buffer.from(rawBody);
}

export function verifyRunnerSignature(input: {
  token: string;
  rawBody: string | Uint8Array;
  signature: string | null | undefined;
}): boolean {
  const match = input.signature?.trim().match(signaturePattern);
  if (!match || input.token.length === 0) return false;

  const expected = createHmac("sha256", input.token)
    .update(bodyBuffer(input.rawBody))
    .digest();
  const received = Buffer.from(match[1], "hex");

  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Generated specs carry their pinned Test Case version in the test title so a
 * Playwright JSON report can be mapped back to immutable evidence without the
 * runner knowing anything about the domain model.
 */
const markerPattern = /\[pwg:([0-9a-f-]{36})\]/i;

export function readTestCaseVersionMarker(title: string): string | null {
  const match = title.match(markerPattern);
  return match ? match[1].toLowerCase() : null;
}

export function buildTestCaseVersionMarker(testCaseVersionId: string): string {
  return `[pwg:${testCaseVersionId}]`;
}

/**
 * Stamps the pinned version marker into generated code deterministically.
 *
 * The model is never asked to reproduce the UUID: language models transcribe
 * long identifiers unreliably, and a single wrong character silently detaches a
 * test result from its evidence. Only the first `test(` title is stamped because
 * one automation artifact covers exactly one Test Case version.
 */
export function applyTestCaseVersionMarker(
  code: string,
  testCaseVersionId: string,
): string {
  const marker = buildTestCaseVersionMarker(testCaseVersionId);
  if (code.includes(marker)) return code;

  return code.replace(/\btest\s*\(\s*(['"`])/, (match) => `${match}${marker} `);
}
