import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
    buildReleaseReviewContext,
    MAX_SOURCE_LENGTH,
    ReleaseReviewProviderError,
    reviewRelease,
} from "@/lib/ai/release-review";
import { EnvironmentValidationError } from "@/lib/env";
import {
    FreeToolLimitError,
    freeToolLimitBody,
    reserveFreeToolRun,
} from "@/lib/operations/free-tool-access";
import { logOperationalEvent } from "@/lib/operations/safe-telemetry";

/**
 * Release Review for a described change. The analysis itself lives in
 * lib/ai/release-review.ts, so it can be measured by an eval without going
 * through HTTP or spending a visitor's daily allowance.
 */
export const maxDuration = 300;

export async function POST(req: Request) {
    const requestId = randomUUID();
    const startedAt = Date.now();

    try {
        const requestBody = await req.json();
        const body =
            typeof requestBody === "object" && requestBody !== null && !Array.isArray(requestBody)
                ? (requestBody as Record<string, unknown>)
                : {};
        const context = buildReleaseReviewContext(body);

        const missingFields: string[] = [];
        if (!context.changeSummary) missingFields.push("Change summary");
        if (!context.expectedBehavior) missingFields.push("Expected behavior");
        if (missingFields.length > 0) {
            return NextResponse.json(
                {
                    error: `${missingFields.join(" and ")} ${missingFields.length === 1 ? "is" : "are"} required.`,
                    fields: missingFields,
                },
                { status: 400 },
            );
        }

        if (context.sourceBundle.length > MAX_SOURCE_LENGTH) {
            return NextResponse.json(
                {
                    error:
                        "The uploaded evidence is too large for one reliable analysis. Remove unrelated files and keep only files connected to this change.",
                },
                { status: 413 },
            );
        }

        const quota = await reserveFreeToolRun({ request: req, surface: "release-review", requestId });

        let result;
        try {
            result = await reviewRelease(context, { requestId });
        } catch (error) {
            if (error instanceof ReleaseReviewProviderError && error.code === "invalid_output") {
                logOperationalEvent("warn", {
                    event: "public_ai.failed",
                    requestId,
                    status: "failed",
                    code: "invalid_output",
                    durationMs: Date.now() - startedAt,
                    surface: "release-review",
                });
                return NextResponse.json(
                    {
                        error:
                            "AI Change Intelligence could not produce a reliable report from this submission. Refine the change details or evidence and try again.",
                        remaining: quota.remaining,
                    },
                    { status: 502, headers: { "x-request-id": requestId } },
                );
            }
            throw error;
        }

        // The model name stays out of the public response.
        const { provider, ...report } = { ...result, model: undefined };
        delete (report as { model?: unknown }).model;
        logOperationalEvent("info", {
            event: "public_ai.completed",
            requestId,
            status: "succeeded",
            durationMs: Date.now() - startedAt,
            surface: "release-review",
            inputTokens: provider.inputTokens,
            outputTokens: provider.outputTokens,
            totalTokens: provider.totalTokens,
            providerRequestId: provider.requestId,
        });

        return NextResponse.json(
            { result: report, remaining: quota.remaining },
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
                surface: "release-review",
            });
            return NextResponse.json(freeToolLimitBody(error), {
                status: 429,
                headers: { "retry-after": String(error.retryAfterSeconds), "x-request-id": requestId },
            });
        }

        const configurationFailure =
            error instanceof EnvironmentValidationError ||
            (error instanceof ReleaseReviewProviderError && error.code === "configuration_missing");
        const invalidRequest = error instanceof SyntaxError;
        const code = configurationFailure ? "configuration_unavailable" : invalidRequest ? "invalid_request" : "provider_error";
        logOperationalEvent(configurationFailure ? "error" : "warn", {
            event: "public_ai.failed",
            requestId,
            status: "failed",
            code,
            durationMs: Date.now() - startedAt,
            surface: "release-review",
        });

        return NextResponse.json(
            {
                error: configurationFailure
                    ? "AI Change Intelligence is temporarily unavailable."
                    : invalidRequest
                      ? "Submit a valid JSON request."
                      : "Failed to run AI Change Intelligence. Please try again.",
            },
            {
                status: configurationFailure ? 503 : invalidRequest ? 400 : 502,
                headers: { "x-request-id": requestId },
            },
        );
    }
}
