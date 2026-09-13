import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";
import { z } from "zod";

import {
  validateOpenAiEnvironment,
  validateRedisEnvironment,
} from "@/lib/env";

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const reservationResultSchema = z.tuple([
  z.coerce.number().int().min(0).max(1),
  z.coerce.number().int().nonnegative(),
  z.coerce.number().int().nonnegative(),
  z.coerce.number().int().min(0).max(2),
]);

const reservationScript = `
local minute_count = tonumber(redis.call("GET", KEYS[1]) or "0")
local daily_count = tonumber(redis.call("GET", KEYS[2]) or "0")
local minute_limit = tonumber(ARGV[1])
local daily_limit = tonumber(ARGV[2])

if minute_count >= minute_limit then
  return {0, minute_count, daily_count, 1}
end
if daily_count >= daily_limit then
  return {0, minute_count, daily_count, 2}
end

minute_count = redis.call("INCR", KEYS[1])
daily_count = redis.call("INCR", KEYS[2])
if minute_count == 1 then redis.call("EXPIRE", KEYS[1], tonumber(ARGV[3])) end
if daily_count == 1 then redis.call("EXPIRE", KEYS[2], tonumber(ARGV[4])) end
return {1, minute_count, daily_count, 0}
`.trim();

export class PublicAiRateLimitError extends Error {
  constructor(
    readonly code: "burst_limit" | "daily_limit",
    readonly retryAfterSeconds: number,
    readonly requestId: string,
  ) {
    super(code);
    this.name = "PublicAiRateLimitError";
  }
}

function clientAddress(request: Request): string {
  return (
    request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function secondsUntilUtcDayEnd(now: Date): number {
  const end = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(60, Math.ceil((end - now.getTime()) / 1_000));
}

export function publicAiClientFingerprint(input: {
  request: Request;
  secret: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(clientAddress(input.request))
    .digest("hex");
}

export async function reservePublicAiRequest(input: {
  request: Request;
  surface: "quick-generate" | "coverage-review" | "release-review" | "preview-run";
  dailyLimit?: number;
  minuteLimit?: number;
  requestId?: string;
  now?: Date;
  source?: EnvironmentSource;
  execute?: (keys: string[], args: string[]) => Promise<unknown>;
}) {
  const source = input.source ?? process.env;
  validateOpenAiEnvironment(source);
  const redisConfig = validateRedisEnvironment(source);
  const requestId = input.requestId ?? randomUUID();
  const now = input.now ?? new Date();
  const dailyLimit = z.number().int().positive().parse(input.dailyLimit ?? 5);
  const minuteLimit = z.number().int().positive().parse(input.minuteLimit ?? 2);
  const hashSecret =
    source.RATE_LIMIT_HASH_SECRET?.trim() ||
    redisConfig.UPSTASH_REDIS_REST_TOKEN;
  const fingerprint = publicAiClientFingerprint({
    request: input.request,
    secret: hashSecret,
  });
  const dailyBucket = now.toISOString().slice(0, 10);
  const prefix = `playwrightgen:public-ai:${input.surface}:${fingerprint}`;
  const keys = [`${prefix}:minute`, `${prefix}:day:${dailyBucket}`];
  const args = [
    String(minuteLimit),
    String(dailyLimit),
    "60",
    String(secondsUntilUtcDayEnd(now)),
  ];
  const execute =
    input.execute ??
    ((scriptKeys: string[], scriptArgs: string[]) => {
      const redis = new Redis({
        url: redisConfig.UPSTASH_REDIS_REST_URL,
        token: redisConfig.UPSTASH_REDIS_REST_TOKEN,
      });
      return redis
        .createScript<unknown>(reservationScript)
        .exec(scriptKeys, scriptArgs);
    });
  const [allowed, minuteCount, dailyCount, reason] =
    reservationResultSchema.parse(await execute(keys, args));

  if (!allowed) {
    throw new PublicAiRateLimitError(
      reason === 1 ? "burst_limit" : "daily_limit",
      reason === 1 ? 60 : secondsUntilUtcDayEnd(now),
      requestId,
    );
  }

  return {
    requestId,
    remaining: Math.max(0, dailyLimit - dailyCount),
    minuteRemaining: Math.max(0, minuteLimit - minuteCount),
  };
}
