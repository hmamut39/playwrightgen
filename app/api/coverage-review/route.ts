import { randomUUID } from "node:crypto";

import { NextResponse, after } from "next/server";

import {
  CoverageReviewProviderError,
  reviewCoverage,
  type CoverageReviewInput,
} from "@/lib/ai/coverage-review";
import { isProviderOutOfCredit, providerFailureReason } from "@/lib/ai/provider-availability";
import { EnvironmentValidationError } from "@/lib/env";
import {
  FreeToolLimitError,
  freeToolLimitBody,
  reserveFreeToolRun,
} from "@/lib/operations/free-tool-access";
import { logOperationalEvent } from "@/lib/operations/safe-telemetry";
import { recordPublicAiUsage } from "@/lib/services/public-ai-usage";
import { capturePageSnapshot, isPublicWebAddress, type PageSnapshot } from "@/lib/free-tools/page-snapshot";
import { readTestAccount } from "@/lib/free-tools/sign-in";
import { saveFreeToolDraft } from "@/lib/services/free-tool-drafts";
import { measureSurfaceCoverage, readControls } from "@/lib/free-tools/surface-coverage";
import { somebodyGotStuck } from "@/lib/operations/stuck-signal";

const lenses = new Set<CoverageReviewInput["lens"]>(["COVERAGE", "FLAKY", "ARCHITECTURE", "ASSERTIONS"]);

async function imageDataUrl(file: File) {
  return `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
}

export async function POST(req: Request) {
  const requestId = randomUUID();
  const startedAt = Date.now();

  try {
    /**
     * A body that cannot be read is the caller's mistake, not a failure here.
     *
     * This read sat inside the handler's outer try, so anything unreadable --
     * JSON sent to a form endpoint, a truncated upload, the wrong content
     * type -- fell through to "Coverage Review failed. Please try again.", with a 500
     * beside it. Both halves were wrong: the status says the server broke
     * when the request did, and the advice is to retry something that cannot
     * succeed however many times it is sent. The JSON routes next door have
     * always answered 400 and said what was missing.
     *
     * Found on 2026-11-14 by walking the public surfaces as a stranger would.
     */
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Send this as a form submission, not JSON." },
        { status: 400 },
      );
    }
    const lens = String(formData.get("lens") || "COVERAGE") as CoverageReviewInput["lens"];
    const pageUrl = String(formData.get("pageUrl") || "").trim();
    const requirement = String(formData.get("requirement") || "").trim();
    const existingTests = String(formData.get("existingTests") || "").trim();
    const screenshotValue = formData.get("screenshot");
    const screenshot = screenshotValue instanceof File && screenshotValue.size > 0 ? screenshotValue : null;
    // A test account for a page behind a login, for this request only.
    const account = readTestAccount(formData);
    if (!account.ok) return NextResponse.json({ error: account.error }, { status: 400 });

    if (!lenses.has(lens)) return NextResponse.json({ error: "Choose a supported review lens." }, { status: 400 });
    if (!pageUrl && !requirement && !existingTests && !screenshot) return NextResponse.json({ error: "Add a requirement, test, URL, or screenshot first." }, { status: 400 });
    if (pageUrl.length > 2_000 || requirement.length > 30_000 || existingTests.length > 250_000) return NextResponse.json({ error: "The submitted evidence is too large for one preliminary review." }, { status: 413 });
    if (screenshot && (!screenshot.type.startsWith("image/") || screenshot.size > 2_000_000)) return NextResponse.json({ error: "Use a PNG, JPEG, or WebP screenshot under 2MB." }, { status: 413 });

    // Refused before the quota, because this costs nothing to decide.
    // Reserving first is deliberate -- it stops the page reader being used as
    // a free service -- but an address that can never be opened is not abuse
    // to be rate-limited, it is a mistake to be answered. Charging one of
    // five daily drafts for a localhost URL, after a minute of "reading the
    // page", is the product taking something for nothing.
    if (pageUrl && !isPublicWebAddress(pageUrl)) {
      return NextResponse.json(
        { error: "Only public web addresses can be opened (not localhost or private networks)." },
        { status: 400 },
      );
    }

    const quota = await reserveFreeToolRun({ request: req, surface: "coverage-review", requestId });

    // Read after the quota is reserved, so the page reader cannot be used free.
    let snapshot: PageSnapshot | null = null;
    if (pageUrl) {
      const snapshotStartedAt = Date.now();
      snapshot = await capturePageSnapshot(pageUrl, account.account ? { account: account.account } : {});
      logOperationalEvent(snapshot.ok ? "info" : "warn", {
        event: "public_ai.page_snapshot",
        requestId,
        status: snapshot.ok ? "succeeded" : "failed",
        code: snapshot.ok ? undefined : snapshot.reason,
        durationMs: Date.now() - snapshotStartedAt,
        surface: "coverage-review",
      });
    }

    const reviewed = await reviewCoverage(
      {
        lens,
        pageUrl,
        requirement,
        existingTests,
        screenshotDataUrl: screenshot ? await imageDataUrl(screenshot) : "",
        pageSnapshot: snapshot?.ok ? snapshot : null,
      },
      { requestId },
    );
    const { provider, ...result } = reviewed;

    logOperationalEvent("info", {
      event: "public_ai.completed",
      requestId,
      status: "succeeded",
      durationMs: Date.now() - startedAt,
      surface: "coverage-review",
      inputTokens: provider.inputTokens,
      outputTokens: provider.outputTokens,
      totalTokens: provider.totalTokens,
      providerRequestId: provider.requestId,
    });
    /*
     * The same counts, kept rather than only logged.
     *
     * A log is gone in a day, so what a week of somebody trying the free
     * tools costs had no answer anywhere. Scheduled with after(), so the
     * visitor waits for nothing, and it cannot fail the request.
     */
    after(() =>
      recordPublicAiUsage({
        surface: "coverage-review",
        model: result.model,
        inputTokens: provider.inputTokens,
        outputTokens: provider.outputTokens,
        totalTokens: provider.totalTokens,
      }),
    );

    const body = {
      result,
      livePage: snapshot
          ? snapshot.ok
            ? {
                status: "read",
                url: snapshot.finalUrl,
                title: snapshot.title,
                counts: snapshot.counts,
                signedIn: Boolean(snapshot.signedIn),
                controls: readControls(snapshot.aria, { pageUrl: snapshot.finalUrl, linkTargets: snapshot.linkTargets }).length,
                // Computed from the page and the pasted tests, not by the model.
                surface: existingTests ? measureSurfaceCoverage(snapshot.aria, existingTests, { pageUrl: snapshot.finalUrl, linkTargets: snapshot.linkTargets }) : null,
                /*
                 * Layout faults from the same load.
                 *
                 * This tool answers "what is not covered", and a page can be
                 * fully covered by passing tests while being unreadable:
                 * every assertion here is a role, a name or a piece of text,
                 * and none of them see a control clipped in half. Coverage
                 * without this reads as a verdict on the page, which it is
                 * not. Null means the check could not run, which is never
                 * shown as a clean result.
                 */
                layoutFaults: snapshot.layoutFaults,
              }
            : { status: "not_read", reason: snapshot.reason, httpStatus: snapshot.status }
          : null,
    };

    // Signed in: keep the review, with the pasted tests and their runs, so it
    // can be reopened later.
    let draftId: string | null = null;
    if (quota.userId) {
      const firstLine = requirement.split("\n").map((line) => line.trim()).find(Boolean);
      draftId = await saveFreeToolDraft({
        clerkUserId: quota.userId,
        source: "coverage-review",
        title: firstLine ? firstLine.slice(0, 300) : pageUrl ? `Review of ${pageUrl}` : "Coverage review",
        pageUrl: pageUrl || null,
        code: existingTests,
        payload: JSON.parse(JSON.stringify({ lens, pageUrl, requirement, existingTests, ...body })),
      }).catch((error: unknown) => {
        console.error("[coverage-review] could not save the review", error);
        return null;
      });
    }

    return NextResponse.json(
      { ...body, draftId, remaining: quota.remaining },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    if (error instanceof FreeToolLimitError) {
      logOperationalEvent("warn", {
        event: "public_ai.rejected",
        requestId,
        status: "rejected",
        code: error.code,
        durationMs: Date.now() - startedAt,
        surface: "coverage-review",
      });
      return NextResponse.json(
        freeToolLimitBody(error),
        {
          status: 429,
          headers: {
            "retry-after": String(error.retryAfterSeconds),
            "x-request-id": requestId,
          },
        },
      );
    }

    // See the note in quick-generate/route.ts: an exhausted account cannot be
    // retried into working, so it is not reported as a failed attempt.
    const outOfCredit = isProviderOutOfCredit(error);
    if (outOfCredit) await somebodyGotStuck({ what: "provider_out_of_credit", where: "coverage-review" });
    const configurationFailure =
      outOfCredit ||
      error instanceof EnvironmentValidationError ||
      (error instanceof CoverageReviewProviderError &&
        error.code === "configuration_missing");
    const providerFailure = error instanceof CoverageReviewProviderError;
    const code = outOfCredit
      ? "provider_out_of_credit"
      : configurationFailure
      ? "configuration_unavailable"
      : providerFailure
        ? error.code
        : "internal_error";
    logOperationalEvent("error", {
      event: "public_ai.failed",
      requestId,
      status: "failed",
      code,
      reason: providerFailureReason(error),
      durationMs: Date.now() - startedAt,
      surface: "coverage-review",
    });
    return NextResponse.json(
      {
        error: outOfCredit
          ? "AI review is paused on this deployment. Nothing is wrong with what you sent, and trying again will not help until it is restored."
          : configurationFailure
          ? "AI review is temporarily unavailable."
          : providerFailure
            ? "The model could not produce a reliable structured review. Refine the evidence and try again."
            : "Coverage Review failed. Please try again.",
      },
      {
        status: configurationFailure ? 503 : providerFailure ? 502 : 500,
        headers: { "x-request-id": requestId },
      },
    );
  }
}
