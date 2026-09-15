import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { EnvironmentValidationError, validateRunnerIngestEnvironment } from "@/lib/env";
import type { PreviewRunResult } from "@/lib/free-tools/preview-run/execute";

/**
 * Proof that a live run happened, and what it found.
 *
 * A run on the free tools happens in the visitor's browser tab as far as the
 * page is concerned: the result comes back as JSON, and anything the page later
 * sends to the Workspace could have been edited on the way. The receipt is what
 * makes "this test passed on the live page" worth recording. The server signs
 * the outcome together with a hash of the exact code it ran, so an imported
 * test keeps its evidence only when it is byte-for-byte the code that ran.
 *
 * Nothing is stored to issue one; the signature is the whole record.
 */

const PREFIX = "pwgr1";
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;

export const runReceiptSchema = z.object({
  v: z.literal(1),
  codeSha256: z.string().regex(/^[0-9a-f]{64}$/),
  pageUrl: z.string().max(2_000),
  verdict: z.enum(["passed", "partial", "failed"]),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
  notReached: z.number().int().min(0),
  tests: z.number().int().min(0),
  durationMs: z.number().int().min(0),
  ranAt: z.string().datetime(),
  /** Names of process.env values the person supplied for the run (never the values). */
  inputs: z.array(z.string().max(64)).max(10).optional(),
});

export type RunReceipt = z.infer<typeof runReceiptSchema>;

/** The signing key, or null on a deployment without one (receipts are then not issued). */
export function readRunReceiptSecret(): string | null {
  try {
    return validateRunnerIngestEnvironment().RUNNER_INGEST_SECRET;
  } catch (error: unknown) {
    if (error instanceof EnvironmentValidationError) return null;
    throw error;
  }
}

export function hashCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

/** passed: every step ran and passed; partial: nothing failed but some steps could not run. */
export function runVerdict(result: Pick<PreviewRunResult, "counts" | "timedOut">): RunReceipt["verdict"] {
  if (result.counts.failed > 0) return "failed";
  if (result.counts.skipped > 0 || result.counts.notReached > 0 || result.timedOut || result.counts.passed === 0) {
    return "partial";
  }
  return "passed";
}

function mac(secret: string, body: string) {
  return createHmac("sha256", secret).update(`pwg:run-receipt:v1:${body}`).digest("base64url");
}

export function signRunReceipt(
  input: { code: string; pageUrl: string; result: PreviewRunResult; ranAt?: Date; inputs?: string[] },
  secret: string,
): string {
  const receipt: RunReceipt = {
    v: 1,
    codeSha256: hashCode(input.code),
    pageUrl: input.pageUrl,
    verdict: runVerdict(input.result),
    passed: input.result.counts.passed,
    failed: input.result.counts.failed,
    skipped: input.result.counts.skipped,
    notReached: input.result.counts.notReached,
    tests: input.result.tests.length,
    durationMs: Math.round(input.result.durationMs),
    ranAt: (input.ranAt ?? new Date()).toISOString(),
    ...(input.inputs?.length ? { inputs: input.inputs.slice(0, 10) } : {}),
  };
  const body = Buffer.from(JSON.stringify(receipt), "utf8").toString("base64url");
  return `${PREFIX}.${body}.${mac(secret, body)}`;
}

/**
 * The receipt's findings, or null when it is forged, expired, or was issued
 * for different code.
 */
export function verifyRunReceipt(
  token: string,
  code: string,
  secret: string,
  now: Date = new Date(),
): RunReceipt | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, body, signature] = parts;
  const expected = Buffer.from(mac(secret, body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  let receipt: RunReceipt;
  try {
    const parsed = runReceiptSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (!parsed.success) return null;
    receipt = parsed.data;
  } catch {
    return null;
  }
  if (receipt.codeSha256 !== hashCode(code)) return null;
  const age = now.getTime() - new Date(receipt.ranAt).getTime();
  if (!Number.isFinite(age) || age < -60_000 || age > MAX_AGE_MS) return null;
  return receipt;
}
