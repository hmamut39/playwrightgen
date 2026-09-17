import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { readSignedInUserId } from "@/lib/auth/signed-in-user";
import { EnvironmentValidationError } from "@/lib/env";
import { runVerdict } from "@/lib/free-tools/preview-run/receipt";
import {
  executeLiveRun,
  LiveRunUnavailableError,
  prepareLiveRun,
  runEnvSchema,
} from "@/lib/free-tools/preview-run/run-draft";
import {
  PublicAiRateLimitError,
  reservePublicAiRequest,
} from "@/lib/operations/public-ai-guard";
import { logOperationalEvent } from "@/lib/operations/safe-telemetry";
import { recordFreeToolDraftRun } from "@/lib/services/free-tool-drafts";

export const runtime = "nodejs";
// A run opens a real browser and replays every step; give it room to finish.
export const maxDuration = 120;

const bodySchema = z.object({
  code: z.string().min(1).max(100_000),
  pageUrl: z.string().trim().min(1).max(2_000),
  /** The signed-in person's saved draft, which keeps this run. */
  draftId: z.string().uuid().optional(),
  env: runEnvSchema.optional(),
});

/**
 * Runs a Quick Generate draft against the live page, step by step.
 *
 * The draft is parsed into a closed set of Playwright operations and replayed
 * in the remote browser; it is never executed as code. Runs cost no model
 * calls, so they have their own allowance of ten a day per address.
 */
export async function POST(req: Request) {
  const requestId = randomUUID();
  const startedAt = Date.now();

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Send the draft code and the page URL." }, { status: 400 });
  }
  const prepared = prepareLiveRun(body);
  if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 400 });

  try {
    const quota = await reservePublicAiRequest({
      request: req,
      surface: "preview-run",
      requestId,
      dailyLimit: 10,
      minuteLimit: 3,
    });

    const { result, receipt } = await executeLiveRun(prepared.run);
    logOperationalEvent("info", {
      event: "public_ai.completed",
      requestId,
      status: "succeeded",
      durationMs: Date.now() - startedAt,
      surface: "preview-run",
    });
    if (body.draftId) {
      const clerkUserId = await readSignedInUserId();
      if (clerkUserId) {
        await recordFreeToolDraftRun({
          clerkUserId,
          draftId: body.draftId,
          code: body.code,
          run: {
            verdict: runVerdict(result),
            passed: result.counts.passed,
            failed: result.counts.failed,
            skipped: result.counts.skipped,
            notReached: result.counts.notReached,
            ranAt: new Date().toISOString(),
            pageUrl: body.pageUrl,
            receipt,
          },
        }).catch((error: unknown) => console.error("[preview-run] could not update the saved draft", error));
      }
    }
    return NextResponse.json(
      { result, receipt, remaining: quota.remaining },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    if (error instanceof PublicAiRateLimitError) {
      return NextResponse.json(
        {
          error:
            error.code === "burst_limit"
              ? "Wait a minute before the next run."
              : "You've used today's 10 live runs. They reset at midnight UTC.",
          remaining: 0,
        },
        { status: 429, headers: { "retry-after": String(error.retryAfterSeconds), "x-request-id": requestId } },
      );
    }
    if (error instanceof LiveRunUnavailableError) {
      return NextResponse.json({ error: "Live runs are not available right now." }, { status: 503 });
    }
    logOperationalEvent("error", {
      event: "public_ai.failed",
      requestId,
      status: "failed",
      code: error instanceof EnvironmentValidationError ? "configuration_unavailable" : "internal_error",
      durationMs: Date.now() - startedAt,
      surface: "preview-run",
    });
    return NextResponse.json(
      { error: "The live run could not be completed. Please try again." },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }
}
