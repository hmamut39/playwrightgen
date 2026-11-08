import { Buffer } from "node:buffer";

import { auth } from "@clerk/nextjs/server";
import { Redis } from "@upstash/redis";
import { Resend } from "resend";
import { z } from "zod";

import { providerFailureReason } from "@/lib/ai/provider-availability";
import { validateRedisEnvironment, validateResendEnvironment } from "@/lib/env";
import { publicAiClientFingerprint } from "@/lib/operations/public-ai-guard";
import { createOperationalResponder } from "@/lib/operations/webhook-telemetry";

/**
 * A way to say what went wrong, from the page it went wrong on.
 *
 * Until now the only route to the author was a GitHub link on the About page:
 * outside the workspace, needing a GitHub account, and public. People trying a
 * tool for a week do not open a public issue about a page that confused them.
 * They close the tab, and the silence reads as "no problems".
 *
 * What makes a report worth having is the two facts every fix in this product
 * has started from: which page, and what it said. So the page path travels
 * with the message, and nothing else does. No screenshot, no page contents, no
 * analytics -- a product asking companies to trial it cannot also be quietly
 * reading their screens, and the form says so where they can read it.
 *
 * Built on the waitlist route's shape, which already solved the hard parts:
 * a size cap before the body is read, one submission a minute per client, and
 * a store that forgets. The mail goes to whoever runs this deployment, which
 * with Resend's shared sender is the only address it can reach anyway.
 */

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 8_192;
const RETENTION_DAYS = 180;
const FEEDBACK_KEY = "playwrightgen:feedback:v1";
const MAX_KEPT = 2_000;

const bodySchema = z.object({
  // Long enough for somebody to describe what they expected and what they
  // saw, short enough that the store stays a store.
  message: z.string().trim().min(1).max(4_000),
  // The page they were on, as the browser knows it. Path only: a query string
  // can carry a token, and this is written to a log and an inbox.
  path: z.string().trim().max(300).optional(),
});

type FeedbackStore = {
  zadd(key: string, item: { member: string; score: number }): Promise<number | null>;
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
  zremrangebyrank(key: string, start: number, stop: number): Promise<number>;
  set(key: string, value: string, options: { ex: number; nx: true }): Promise<unknown>;
};

type FeedbackDependencies = {
  createStore(config: { token: string; url: string }): FeedbackStore;
  notify(input: { apiKey: string; recipient: string; subject: string; text: string }): Promise<void>;
  now(): number;
};

const defaultDependencies: FeedbackDependencies = {
  createStore: (config) => new Redis(config) as unknown as FeedbackStore,
  async notify({ apiKey, recipient, subject, text }) {
    const resend = new Resend(apiKey);
    // Resend answers a refused send with an error object rather than by
    // throwing, so an unchecked call cannot tell "delivered" from "rejected".
    // The sender here is Resend's shared sandbox address, which is allowed to
    // reach only the account owner's own email -- exactly the setting that
    // gets this wrong quietly.
    const result = await resend.emails.send({
      from: "PlaywrightGen <onboarding@resend.dev>",
      to: recipient,
      subject,
      text,
    });
    if (result.error) throw new Error(result.error.message);
  },
  now: () => Date.now(),
};

/** The path only, and only if it looks like one. */
function safePath(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return null;
  return trimmed.split("?")[0].split("#")[0].slice(0, 300);
}

export async function handleFeedbackRequest(
  request: Request,
  dependencies: FeedbackDependencies = defaultDependencies,
) {
  const responder = createOperationalResponder({ event: "feedback.request", surface: "product-feedback" });
  const respond = (code: string, status: number, message: string) =>
    responder.json(
      status >= 400 ? { status: "error", code, error: message } : { status: "ok", code, success: true, message },
      { status, code },
    );

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return respond("payload_too_large", 413, "That message is too long to send.");
  }

  let input: unknown;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
      return respond("payload_too_large", 413, "That message is too long to send.");
    }
    input = JSON.parse(rawBody);
  } catch {
    return respond("invalid_request", 400, "Write what went wrong and send it again.");
  }

  const parsed = bodySchema.safeParse(input);
  if (!parsed.success) {
    return respond("invalid_message", 400, "Write what went wrong and send it again.");
  }

  // Who, when they are signed in. Never asked of the browser: an identity the
  // client supplies is one anybody can supply.
  let who = "a signed-out visitor";
  try {
    const session = await auth();
    if (session.userId) who = session.orgId ? `${session.userId} in ${session.orgId}` : session.userId;
  } catch {
    // The session is a nicety here. A report that arrives anonymously is
    // worth more than one that was refused.
  }

  try {
    const redisConfig = validateRedisEnvironment();
    const store = dependencies.createStore({
      url: redisConfig.UPSTASH_REDIS_REST_URL,
      token: redisConfig.UPSTASH_REDIS_REST_TOKEN,
    });
    const hashSecret = process.env.RATE_LIMIT_HASH_SECRET?.trim() || redisConfig.UPSTASH_REDIS_REST_TOKEN;
    const fingerprint = publicAiClientFingerprint({ request, secret: hashSecret });
    const reservation = await store.set(`playwrightgen:feedback:limit:${fingerprint}`, "1", { ex: 60, nx: true });
    if (reservation === null) {
      const response = respond("rate_limited", 429, "Wait a minute before sending another.");
      response.headers.set("Retry-After", "60");
      return response;
    }

    const now = dependencies.now();
    const path = safePath(parsed.data.path);
    const entry = JSON.stringify({ at: new Date(now).toISOString(), who, path, message: parsed.data.message });

    await store.zremrangebyscore(FEEDBACK_KEY, 0, now - RETENTION_DAYS * 24 * 60 * 60 * 1_000);
    await store.zadd(FEEDBACK_KEY, { score: now, member: entry });
    // Oldest first, so trimming from the front keeps what arrived most
    // recently. A store that grows without a ceiling is an outage later.
    await store.zremrangebyrank(FEEDBACK_KEY, 0, -(MAX_KEPT + 1));

    const recipient = process.env.FEEDBACK_NOTIFY_EMAIL?.trim() || process.env.WAITLIST_NOTIFY_EMAIL?.trim();
    if (recipient) {
      try {
        const { RESEND_API_KEY } = validateResendEnvironment();
        await dependencies.notify({
          apiKey: RESEND_API_KEY,
          recipient,
          subject: `PlaywrightGen feedback${path ? ` from ${path}` : ""}`,
          text: [`From: ${who}`, `Page: ${path ?? "(not given)"}`, "", parsed.data.message].join("\n"),
        });
      } catch (error) {
        // Kept, not sent. Losing the report because a mail server was slow
        // would be the one outcome worse than not being told -- so the person
        // still gets their thank you. But a refused notice used to end here in
        // silence, which meant the inbox could be empty for weeks while every
        // request logged "succeeded" and the owner believed reports arrived.
        responder.note("notice_not_sent", providerFailureReason(error));
      }
    }

    return respond("feedback_received", 200, "Thank you. That went straight to the person who builds this.");
  } catch {
    return respond("feedback_unavailable", 503, "That could not be sent just now. Please try again shortly.");
  }
}

export async function POST(request: Request) {
  return handleFeedbackRequest(request);
}
