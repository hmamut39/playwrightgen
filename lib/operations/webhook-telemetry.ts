import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { logOperationalEvent } from "@/lib/operations/safe-telemetry";

export function createOperationalResponder(input: {
  event: string;
  surface: string;
}) {
  const requestId = randomUUID();
  const startedAt = Date.now();

  return {
    json(
      body: unknown,
      options: {
        code?: string;
        status?: number;
      } = {},
    ) {
      const status = options.status ?? 200;
      const outcome =
        status >= 500 ? "failed" : status >= 400 ? "rejected" : "succeeded";
      const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";

      logOperationalEvent(level, {
        event: input.event,
        requestId,
        status: outcome,
        code: options.code,
        durationMs: Math.max(0, Date.now() - startedAt),
        surface: input.surface,
      });

      return NextResponse.json(body, {
        status,
        headers: {
          "Cache-Control": "no-store",
          "x-request-id": requestId,
        },
      });
    },

    /**
     * Something went wrong that the caller is deliberately not told about.
     *
     * A request can succeed for the person and still fail at something the
     * owner needs to know about -- a notice that was refused by the mail
     * provider, say. Reporting that to the sender would be noise, and
     * swallowing it means nobody ever learns. This records it against the
     * same request id as the response, so the two line up in the log.
     */
    note(code: string, reason?: string) {
      logOperationalEvent("warn", {
        event: input.event,
        requestId,
        status: "failed",
        code,
        durationMs: Math.max(0, Date.now() - startedAt),
        surface: input.surface,
        ...(reason ? { reason } : {}),
      });
    },
  };
}

export function createWebhookResponder(surface: string) {
  return createOperationalResponder({
    event: "webhook.delivery",
    surface,
  });
}
