import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { createOperationalResponder } from "@/lib/operations/webhook-telemetry";

export function legacyAiRouteQuarantine(input: {
  replacement: string;
  source?: Readonly<Record<string, string | undefined>>;
}) {
  const source = input.source ?? process.env;
  if (source.ENABLE_LEGACY_AI_ROUTES === "true") return null;

  const requestId = randomUUID();
  return NextResponse.json(
    {
      error: "This legacy AI endpoint is unavailable.",
      code: "legacy_endpoint_quarantined",
      replacement: input.replacement,
    },
    {
      status: 410,
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    },
  );
}

export function legacyAiRouteFailure(surface: string) {
  return createOperationalResponder({
    event: "legacy_ai.request",
    surface,
  }).json(
    {
      error: "This legacy AI request failed.",
      code: "legacy_endpoint_failed",
    },
    {
      status: 500,
      code: "legacy_endpoint_failed",
    },
  );
}
