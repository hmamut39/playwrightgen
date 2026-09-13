import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { executePreviewRun } from "@/lib/free-tools/preview-run/execute";
import { planPreviewRun } from "@/lib/free-tools/preview-run/plan";
import { connectRemoteBrowser, isPublicWebAddress } from "@/lib/free-tools/page-snapshot";
import { EnvironmentValidationError } from "@/lib/env";
import {
  PublicAiRateLimitError,
  reservePublicAiRequest,
} from "@/lib/operations/public-ai-guard";
import { logOperationalEvent } from "@/lib/operations/safe-telemetry";

export const runtime = "nodejs";
// A run opens a real browser and replays every step; give it room to finish.
export const maxDuration = 120;

const bodySchema = z.object({
  code: z.string().min(1).max(100_000),
  pageUrl: z.string().trim().min(1).max(2_000),
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
  if (!isPublicWebAddress(body.pageUrl)) {
    return NextResponse.json({ error: "Only public web addresses can be opened." }, { status: 400 });
  }
  const plan = planPreviewRun(body.code);
  if (plan.tests.length === 0) {
    return NextResponse.json({ error: "No Playwright test was found in the draft." }, { status: 400 });
  }

  try {
    const quota = await reservePublicAiRequest({
      request: req,
      surface: "preview-run",
      requestId,
      dailyLimit: 10,
      minuteLimit: 3,
    });

    const browser = await connectRemoteBrowser().catch(() => null);
    if (!browser) {
      return NextResponse.json({ error: "Live runs are not available right now." }, { status: 503 });
    }
    try {
      const result = await executePreviewRun(plan, { browser, baseUrl: body.pageUrl, budgetMs: 80_000 });
      logOperationalEvent("info", {
        event: "public_ai.completed",
        requestId,
        status: "succeeded",
        durationMs: Date.now() - startedAt,
        surface: "preview-run",
      });
      return NextResponse.json(
        { result, remaining: quota.remaining },
        { headers: { "x-request-id": requestId } },
      );
    } finally {
      await browser.close().catch(() => {});
    }
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
