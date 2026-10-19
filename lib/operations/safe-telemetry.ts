import "server-only";

import { z } from "zod";

const operationalEventSchema = z.object({
  event: z.string().regex(/^[a-z0-9_.-]+$/).max(100),
  requestId: z.string().uuid(),
  status: z.enum(["succeeded", "rejected", "failed"]),
  code: z.string().regex(/^[a-z0-9_.-]+$/).max(100).optional(),
  durationMs: z.number().int().nonnegative().max(3_600_000),
  surface: z.string().regex(/^[a-z0-9_.-]+$/).max(100),
  inputTokens: z.number().int().nonnegative().nullable().optional(),
  outputTokens: z.number().int().nonnegative().nullable().optional(),
  totalTokens: z.number().int().nonnegative().nullable().optional(),
  providerRequestId: z.string().max(255).nullable().optional(),
  /**
   * Why an unexpected failure happened, in the upstream service's own words.
   *
   * This schema is an allowlist so that nothing reaches a log by accident,
   * and for a long time it held no field for a reason at all -- which meant a
   * production failure logged its code and stopped there. On 2026-10-19 the
   * home page's generator was answering 500 for everyone because the AI
   * account had run out of credit, and `{"code":"internal_error"}` was the
   * entire record of it.
   *
   * Bounded and sanitised rather than free: callers pass it through
   * `providerFailureReason`, which strips anything shaped like a key and caps
   * the length. Never put a request body, a prompt or a user's input here.
   */
  reason: z.string().max(300).optional(),
});

export type OperationalEvent = z.input<typeof operationalEventSchema>;

export function logOperationalEvent(
  level: "info" | "warn" | "error",
  event: OperationalEvent,
) {
  const safeEvent = operationalEventSchema.parse(event);
  console[level](JSON.stringify(safeEvent));
}
