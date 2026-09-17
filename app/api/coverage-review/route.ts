import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  CoverageReviewProviderError,
  reviewCoverage,
  type CoverageReviewInput,
} from "@/lib/ai/coverage-review";
import { EnvironmentValidationError } from "@/lib/env";
import {
  FreeToolLimitError,
  freeToolLimitBody,
  reserveFreeToolRun,
} from "@/lib/operations/free-tool-access";
import { logOperationalEvent } from "@/lib/operations/safe-telemetry";
import { capturePageSnapshot, type PageSnapshot } from "@/lib/free-tools/page-snapshot";
import { readTestAccount } from "@/lib/free-tools/sign-in";
import { saveFreeToolDraft } from "@/lib/services/free-tool-drafts";
import { measureSurfaceCoverage, readControls } from "@/lib/free-tools/surface-coverage";

const lenses = new Set<CoverageReviewInput["lens"]>(["COVERAGE", "FLAKY", "ARCHITECTURE", "ASSERTIONS"]);

async function imageDataUrl(file: File) {
  return `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
}

export async function POST(req: Request) {
  const requestId = randomUUID();
  const startedAt = Date.now();

  try {
    const formData = await req.formData();
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
                controls: readControls(snapshot.aria).length,
                // Computed from the page and the pasted tests, not by the model.
                surface: existingTests ? measureSurfaceCoverage(snapshot.aria, existingTests) : null,
              }
            : { status: "not_read", reason: snapshot.reason }
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

    const configurationFailure =
      error instanceof EnvironmentValidationError ||
      (error instanceof CoverageReviewProviderError &&
        error.code === "configuration_missing");
    const providerFailure = error instanceof CoverageReviewProviderError;
    const code = configurationFailure
      ? "configuration_unavailable"
      : providerFailure
        ? error.code
        : "internal_error";
    logOperationalEvent("error", {
      event: "public_ai.failed",
      requestId,
      status: "failed",
      code,
      durationMs: Date.now() - startedAt,
      surface: "coverage-review",
    });
    return NextResponse.json(
      {
        error: configurationFailure
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
