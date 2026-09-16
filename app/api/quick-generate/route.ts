import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  generateQuickDraft,
  QuickGenerationProviderError,
  type QuickGenerationInput,
} from "@/lib/ai/quick-generation";
import { EnvironmentValidationError } from "@/lib/env";
import { capturePageSnapshot, type PageSnapshot } from "@/lib/free-tools/page-snapshot";
import {
  FreeToolLimitError,
  freeToolLimitBody,
  reserveFreeToolRun,
} from "@/lib/operations/free-tool-access";
import { readTestAccount } from "@/lib/free-tools/sign-in";
import { saveFreeToolDraft } from "@/lib/services/free-tool-drafts";
import { logOperationalEvent } from "@/lib/operations/safe-telemetry";

const MAX_TEXT_FILE_BYTES = 250_000;
const MAX_TEXT_CONTEXT = 500_000;
const MAX_IMAGE_BYTES = 2_000_000;
const allowedModes = new Set<QuickGenerationInput["mode"]>(["FLOW", "MARKUP", "COMPONENT", "API"]);

async function fileToDataUrl(file: File): Promise<string> {
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  return `data:${file.type};base64,${base64}`;
}

export async function POST(req: Request) {
  const requestId = randomUUID();
  const startedAt = Date.now();

  try {
    const formData = await req.formData();
    const mode = String(formData.get("mode") || "FLOW") as QuickGenerationInput["mode"];
    const request = String(formData.get("request") || "").trim();
    const pageUrl = String(formData.get("pageUrl") || "").trim();
    const depth = String(formData.get("depth") || "FOCUSED") === "EXPANDED" ? "EXPANDED" : "FOCUSED";
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    // A test account for a page behind a login: typed into the site's login
    // form in the remote browser for this request only. Never stored, logged,
    // sent to the model, or returned.
    const account = readTestAccount(formData);
    if (!account.ok) return NextResponse.json({ error: account.error }, { status: 400 });

    if (!allowedModes.has(mode)) return NextResponse.json({ error: "Choose a supported generation mode." }, { status: 400 });
    if (!request && files.length === 0) return NextResponse.json({ error: "Describe the behavior or attach relevant evidence first." }, { status: 400 });
    if (request.length > 30_000 || pageUrl.length > 2_000) return NextResponse.json({ error: "The submitted text is too large." }, { status: 413 });
    if (files.length > 6) return NextResponse.json({ error: "Attach no more than six files." }, { status: 413 });

    let totalTextBytes = 0;
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        if (file.size > MAX_IMAGE_BYTES) return NextResponse.json({ error: `Image ${file.name} must be under 2MB.` }, { status: 413 });
      } else {
        if (file.size > MAX_TEXT_FILE_BYTES) return NextResponse.json({ error: `File ${file.name} must be under 250KB.` }, { status: 413 });
        totalTextBytes += file.size;
        if (totalTextBytes > MAX_TEXT_CONTEXT) return NextResponse.json({ error: "Keep total attached text under 500KB." }, { status: 413 });
      }
    }

    const quota = await reserveFreeToolRun({ request: req, surface: "quick-generate", requestId });

    const textParts: string[] = [];
    const imageDataUrls: string[] = [];
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        imageDataUrls.push(await fileToDataUrl(file));
        continue;
      }
      textParts.push(`===FILE: ${file.name}===\n${await file.text()}`);
    }

    // Browser modes get the real page, read after the quota is reserved so the
    // page reader cannot be used for free. API mode tests requests, not pages.
    let snapshot: PageSnapshot | null = null;
    if (pageUrl && mode !== "API") {
      const snapshotStartedAt = Date.now();
      snapshot = await capturePageSnapshot(pageUrl, account.account ? { account: account.account } : {});
      logOperationalEvent(snapshot.ok ? "info" : "warn", {
        event: "public_ai.page_snapshot",
        requestId,
        status: snapshot.ok ? "succeeded" : "failed",
        code: snapshot.ok ? undefined : snapshot.reason,
        durationMs: Date.now() - snapshotStartedAt,
        surface: "quick-generate",
      });
    }

    const generated = await generateQuickDraft(
      {
        mode,
        request,
        pageUrl,
        depth,
        fileContext: textParts.join("\n\n"),
        imageDataUrls,
        pageSnapshot: snapshot?.ok ? snapshot : null,
      },
      { requestId },
    );
    const { provider, ...result } = generated;

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

    const body = {
      result,
      livePage: snapshot
        ? snapshot.ok
          ? {
              status: "read",
              url: snapshot.finalUrl,
              title: snapshot.title,
              counts: snapshot.counts,
              truncated: snapshot.truncated,
              excerpt: snapshot.aria.slice(0, 4_000),
              signedIn: Boolean(snapshot.signedIn),
            }
          : { status: "not_read", reason: snapshot.reason }
        : null,
      inputSignals: [
        request ? "Requirement or prompt" : null,
        snapshot?.ok ? "Live page read" : pageUrl ? "Page URL (not opened)" : null,
        textParts.length ? `${textParts.length} text file${textParts.length === 1 ? "" : "s"}` : null,
        imageDataUrls.length ? `${imageDataUrls.length} image${imageDataUrls.length === 1 ? "" : "s"}` : null,
      ].filter((signal): signal is string => Boolean(signal)),
    };

    // Signed in: keep the draft so it survives the tab and can be reopened.
    let draftId: string | null = null;
    if (quota.userId) {
      draftId = await saveFreeToolDraft({
        clerkUserId: quota.userId,
        source: "quick-generate",
        title: result.title,
        pageUrl: pageUrl || null,
        code: result.code,
        payload: JSON.parse(JSON.stringify({ mode, depth, request, pageUrl, ...body })),
      }).catch((error: unknown) => {
        console.error("[quick-generate] could not save the draft", error);
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
        surface: "quick-generate",
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
      (error instanceof QuickGenerationProviderError &&
        error.code === "configuration_missing");
    const providerFailure = error instanceof QuickGenerationProviderError;
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
      surface: "quick-generate",
    });
    return NextResponse.json(
      {
        error: configurationFailure
          ? "AI generation is temporarily unavailable."
          : providerFailure
            ? "The model could not produce a safe structured draft. Please refine the input and try again."
            : "Quick Generate failed. Please try again.",
      },
      {
        status: configurationFailure ? 503 : providerFailure ? 502 : 500,
        headers: { "x-request-id": requestId },
      },
    );
  }
}
