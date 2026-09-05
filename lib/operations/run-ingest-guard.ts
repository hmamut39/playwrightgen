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

/**
 * Reserves ingest capacity for one organization before any evidence is written.
 *
 * Two windows, because they bound different risks. The per-minute window bounds
 * request rate, which protects the endpoint. The daily window counts *results*
 * rather than requests, because a single accepted post can carry hundreds of
 * them and that is what actually writes rows and costs storage. Limiting only
 * requests would let one misconfigured workflow insert a very large number of
 * attempts while appearing to stay well inside its quota.
 *
 * The whole reservation is one Lua script so the check and the increment cannot
 * interleave between concurrent CI jobs.
 */
const reservationScript = `
local minute_count = tonumber(redis.call("GET", KEYS[1]) or "0")
local daily_results = tonumber(redis.call("GET", KEYS[2]) or "0")
local minute_limit = tonumber(ARGV[1])
local daily_result_limit = tonumber(ARGV[2])
local results = tonumber(ARGV[5])

if minute_count >= minute_limit then
  return {0, minute_count, daily_results, 1}
end
if daily_results + results > daily_result_limit then
  return {0, minute_count, daily_results, 2}
end

minute_count = redis.call("INCR", KEYS[1])
daily_results = redis.call("INCRBY", KEYS[2], results)
if minute_count == 1 then redis.call("EXPIRE", KEYS[1], tonumber(ARGV[3])) end
if daily_results == results then redis.call("EXPIRE", KEYS[2], tonumber(ARGV[4])) end
return {1, minute_count, daily_results, 0}
`.trim();

export class RunIngestRateLimitError extends Error {
  constructor(
    readonly code: "ingest_burst_limit" | "ingest_daily_limit",
    readonly retryAfterSeconds: number,
  ) {
    super(code);
    this.name = "RunIngestRateLimitError";
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
  return z.coerce.number().int().positive().max(1_000_000).parse(raw);
}

export async function reserveRunIngest(input: {
  organizationId: string;
  resultCount: number;
  source?: EnvironmentSource;
  now?: Date;
  execute?: (keys: string[], args: string[]) => Promise<unknown>;
}) {
  const organizationId = uuid.parse(input.organizationId);
  const resultCount = z.number().int().positive().max(500).parse(input.resultCount);
  const source = input.source ?? process.env;
  const redisConfig = validateRedisEnvironment(source);
  const now = input.now ?? new Date();

  // Defaults are deliberately generous. CI reports on every push, and a limit
  // that trips during ordinary work would train people to ignore it.
  const minuteLimit = positiveLimit(source, "RUN_INGEST_MINUTE_LIMIT", 60);
  const dailyResultLimit = positiveLimit(source, "RUN_INGEST_DAILY_RESULT_LIMIT", 20_000);

  const prefix = `playwrightgen:run-ingest:${organizationId}`;
  const keys = [
    `${prefix}:minute`,
    `${prefix}:day:${now.toISOString().slice(0, 10)}`,
  ];
  const args = [
    String(minuteLimit),
    String(dailyResultLimit),
    "60",
    String(secondsUntilUtcDayEnd(now)),
    String(resultCount),
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

  const [allowed, minuteCount, dailyResults, reason] = resultSchema.parse(
    await execute(keys, args),
  );

  if (!allowed) {
    throw new RunIngestRateLimitError(
      reason === 1 ? "ingest_burst_limit" : "ingest_daily_limit",
      reason === 1 ? 60 : secondsUntilUtcDayEnd(now),
    );
  }

  return {
    minuteRemaining: Math.max(0, minuteLimit - minuteCount),
    dailyResultsRemaining: Math.max(0, dailyResultLimit - dailyResults),
  };
}
