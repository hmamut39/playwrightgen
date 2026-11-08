import { Buffer } from "node:buffer";

import { Redis } from "@upstash/redis";
import { Resend } from "resend";
import { z } from "zod";

import {
  validateRedisEnvironment,
  validateResendEnvironment,
} from "@/lib/env";
import { providerFailureReason } from "@/lib/ai/provider-availability";
import { publicAiClientFingerprint } from "@/lib/operations/public-ai-guard";
import { createOperationalResponder } from "@/lib/operations/webhook-telemetry";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 2_048;
const RETENTION_DAYS = 180;
const WAITLIST_KEY = "playwrightgen:waitlist:v2";
const emailSchema = z.string().trim().toLowerCase().email().max(320);

type WaitlistStore = {
  set(
    key: string,
    value: string,
    options: { ex: number; nx: true },
  ): Promise<unknown>;
  zadd(
    key: string,
    item: { member: string; score: number },
  ): Promise<number | null>;
  zremrangebyscore(key: string, min: number, max: number): Promise<number>;
};

type WaitlistDependencies = {
  createStore(config: { token: string; url: string }): WaitlistStore;
  notify(input: { apiKey: string; email: string; recipient: string }): Promise<void>;
  now(): number;
};

const defaultDependencies: WaitlistDependencies = {
  createStore: (config) => new Redis(config),
  async notify({ apiKey, email, recipient }) {
    const resend = new Resend(apiKey);
    // Checked, not assumed: Resend reports a refusal in the result rather than
    // by throwing. See the same note on the feedback route.
    const result = await resend.emails.send({
      from: "PlaywrightGen <onboarding@resend.dev>",
      to: recipient,
      subject: "New PlaywrightGen waitlist signup",
      text: `A new user joined the PlaywrightGen team-access waitlist: ${email}`,
    });
    if (result.error) throw new Error(result.error.message);
  },
  now: () => Date.now(),
};

export async function handleWaitlistRequest(
  request: Request,
  dependencies: WaitlistDependencies = defaultDependencies,
) {
  const responder = createOperationalResponder({
    event: "waitlist.request",
    surface: "team-waitlist",
  });
  const respond = (code: string, status: number, message: string) =>
    responder.json(
      status >= 400
        ? { status: "error", code, error: message }
        : { status: "ok", code, success: true, message },
      { status, code },
    );

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return respond("payload_too_large", 413, "The waitlist request is too large.");
  }

  let input: unknown;
  try {
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
      return respond("payload_too_large", 413, "The waitlist request is too large.");
    }
    input = JSON.parse(rawBody);
  } catch {
    return respond("invalid_request", 400, "Enter a valid email address.");
  }

  const parsed = z.object({ email: emailSchema }).safeParse(input);
  if (!parsed.success) {
    return respond("invalid_email", 400, "Enter a valid email address.");
  }

  try {
    const redisConfig = validateRedisEnvironment();
    const store = dependencies.createStore({
      url: redisConfig.UPSTASH_REDIS_REST_URL,
      token: redisConfig.UPSTASH_REDIS_REST_TOKEN,
    });
    const hashSecret =
      process.env.RATE_LIMIT_HASH_SECRET?.trim() ||
      redisConfig.UPSTASH_REDIS_REST_TOKEN;
    const fingerprint = publicAiClientFingerprint({
      request,
      secret: hashSecret,
    });
    const reservation = await store.set(
      `playwrightgen:waitlist:limit:${fingerprint}`,
      "1",
      { ex: 60, nx: true },
    );
    if (reservation === null) {
      const response = respond(
        "rate_limited",
        429,
        "Wait a minute before trying again.",
      );
      response.headers.set("Retry-After", "60");
      return response;
    }

    const now = dependencies.now();
    await store.zremrangebyscore(
      WAITLIST_KEY,
      0,
      now - RETENTION_DAYS * 24 * 60 * 60 * 1_000,
    );
    const added =
      (await store.zadd(WAITLIST_KEY, {
        score: now,
        member: parsed.data.email,
      })) ?? 0;

    const recipient = process.env.WAITLIST_NOTIFY_EMAIL?.trim();
    if (recipient && added > 0) {
      try {
        const { RESEND_API_KEY } = validateResendEnvironment();
        await dependencies.notify({
          apiKey: RESEND_API_KEY,
          email: parsed.data.email,
          recipient,
        });
      } catch (error) {
        // They are on the list; the notice about it is a separate thing. This
        // used to fall to the outer catch, which answered "The waitlist is
        // temporarily unavailable" to somebody who had just been added -- so
        // they would sign up again, and the only record of why was nothing.
        responder.note("notice_not_sent", providerFailureReason(error));
      }
    }

    return respond(
      added > 0 ? "waitlist_joined" : "already_registered",
      200,
      added > 0
        ? "You are on the team-access waitlist."
        : "This email is already on the team-access waitlist.",
    );
  } catch {
    return respond(
      "waitlist_unavailable",
      503,
      "The waitlist is temporarily unavailable.",
    );
  }
}

export async function POST(request: Request) {
  return handleWaitlistRequest(request);
}
