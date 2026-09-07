import "server-only";

import { Redis } from "@upstash/redis";
import { z } from "zod";

import { validateRedisEnvironment } from "@/lib/env";

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const uuid = z.string().uuid();
const resultSchema = z.tuple([
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

export class OrganizationAiRateLimitError extends Error {
  constructor(
    readonly code: "organization_burst_limit" | "organization_daily_limit",
    readonly retryAfterSeconds: number,
  ) {
    super(code);
    this.name = "OrganizationAiRateLimitError";
  }
}

function secondsUntilUtcDayEnd(now: Date): number {
  const end = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(60, Math.ceil((end - now.getTime()) / 1_000));
}

function positiveLimit(
  source: EnvironmentSource,
  name: string,
  fallback: number,
): number {
  const raw = source[name]?.trim();
  if (!raw) return fallback;
  return z.coerce.number().int().positive().max(100_000).parse(raw);
}

export async function reserveOrganizationAiRequest(input: {
  organizationId: string;
  surface:
    | "requirement-review"
    | "failure-analysis"
    | "automation-generation"
    | "test-case-proposals";
  source?: EnvironmentSource;
  now?: Date;
  execute?: (keys: string[], args: string[]) => Promise<unknown>;
}) {
  const organizationId = uuid.parse(input.organizationId);
  const source = input.source ?? process.env;
  const redisConfig = validateRedisEnvironment(source);
  const now = input.now ?? new Date();
  const minuteLimit = positiveLimit(
    source,
    "ORGANIZATION_AI_MINUTE_LIMIT",
    4,
  );
  const dailyLimit = positiveLimit(
    source,
    "ORGANIZATION_AI_DAILY_LIMIT",
    20,
  );
  const prefix = `playwrightgen:organization-ai:${organizationId}`;
  const keys = [
    `${prefix}:minute`,
    `${prefix}:day:${now.toISOString().slice(0, 10)}`,
  ];
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
  const [allowed, minuteCount, dailyCount, reason] = resultSchema.parse(
    await execute(keys, args),
  );

  if (!allowed) {
    throw new OrganizationAiRateLimitError(
      reason === 1 ? "organization_burst_limit" : "organization_daily_limit",
      reason === 1 ? 60 : secondsUntilUtcDayEnd(now),
    );
  }

  return {
    surface: input.surface,
    dailyRemaining: Math.max(0, dailyLimit - dailyCount),
    minuteRemaining: Math.max(0, minuteLimit - minuteCount),
  };
}
