import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { DraftRepairProviderError, repairDraft } from "@/lib/ai/draft-repair";
import { isPublicWebAddress } from "@/lib/free-tools/page-snapshot";
import {
  FreeToolLimitError,
  freeToolLimitBody,
  reserveFreeToolRun,
} from "@/lib/operations/free-tool-access";
import { logOperationalEvent } from "@/lib/operations/safe-telemetry";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  code: z.string().min(1).max(100_000),
  pageUrl: z.string().trim().min(1).max(2_000),
  failure: z.object({
    step: z.string().max(300),
    line: z.string().max(1_000),
    reason: z.string().max(2_000),
  }),
  pageTreeAtFailure: z.string().min(1).max(20_000),
  pageTreeAtStart: z.string().max(20_000).optional(),
});

/**
 * Fixes the step a live run showed failing. Counts as one Quick Generate run,
 * since it is a model call of the same size.
 */
export async function POST(req: Request) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Send the draft, the failing step and the page it failed on." }, { status: 400 });
  }
  if (!isPublicWebAddress(body.pageUrl)) {
    return NextResponse.json({ error: "Only public web addresses can be used." }, { status: 400 });
  }

  try {
    const quota = await reserveFreeToolRun({ request: req, surface: "quick-generate", requestId });
    const repaired = await repairDraft(body, { requestId });
    const { provider, ...result } = repaired;
    logOperationalEvent("info", {
      event: "public_ai.completed",
      requestId,
      status: "succeeded",
      durationMs: Date.now() - startedAt,
      surface: "quick-generate",
      inputTokens: provider.inputTokens,
      outputTokens: provider.outputTokens,
      totalTokens: provider.totalTokens,
      providerRequestId: provider.requestId,
    });
    return NextResponse.json({ result, remaining: quota.remaining }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    if (error instanceof FreeToolLimitError) {
      return NextResponse.json(freeToolLimitBody(error), {
        status: 429,
        headers: { "retry-after": String(error.retryAfterSeconds), "x-request-id": requestId },
      });
    }
    logOperationalEvent("error", {
      event: "public_ai.failed",
      requestId,
      status: "failed",
      code: error instanceof DraftRepairProviderError ? error.code : "internal_error",
      durationMs: Date.now() - startedAt,
      surface: "quick-generate",
    });
    return NextResponse.json(
      { error: "The draft could not be fixed automatically. Try editing the failing line by hand." },
      { status: error instanceof DraftRepairProviderError ? 502 : 500, headers: { "x-request-id": requestId } },
    );
  }
}
