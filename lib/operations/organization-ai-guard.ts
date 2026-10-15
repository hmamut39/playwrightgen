import "server-only";

import { Redis } from "@upstash/redis";
import { z } from "zod";

import { validateRedisEnvironment } from "@/lib/env";
import { getOrganizationLimits } from "@/lib/services/entitlements";

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

-- Which surface spent it. Counted here rather than anywhere else because
-- this is the one place every AI request in the product passes through, and
-- counted inside the same script so the breakdown can never disagree with
-- the total it breaks down. It expires with the day it describes.
local surface_total = redis.call("HINCRBY", KEYS[3], ARGV[5], 1)
if surface_total == 1 then redis.call("EXPIRE", KEYS[3], tonumber(ARGV[4])) end

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

export async function reserveOrganizationAiRequest(input: {
  organizationId: string;
  surface:
    | "requirement-review"
    | "failure-analysis"
    | "automation-generation"
    | "test-case-proposals"
    | "free-tools"
    | "page-coverage"
    | "requirement-drafting"
    | "criteria-coverage"
    | "automation-repair";
  source?: EnvironmentSource;
  now?: Date;
  execute?: (keys: string[], args: string[]) => Promise<unknown>;
  resolveLimits?: typeof getOrganizationLimits;
}) {
  const organizationId = uuid.parse(input.organizationId);
  const source = input.source ?? process.env;
  const redisConfig = validateRedisEnvironment(source);
  const now = input.now ?? new Date();

  // Resolved from the organization's entitlements rather than from a constant.
  // Subscriptions were being recorded and never read, so an organization that
  // paid received exactly the allowance it already had for nothing -- which is
  // worse than offering no paid plan, because it takes money and changes
  // nothing. Limits are injectable so the guard stays testable without a
  // database.
  const limits = await (input.resolveLimits ?? getOrganizationLimits)({
    organizationId,
    now,
    source,
  });
  const minuteLimit = limits.aiMinuteLimit;
  const dailyLimit = limits.aiDailyLimit;
  const prefix = `playwrightgen:organization-ai:${organizationId}`;
  const day = now.toISOString().slice(0, 10);
  const keys = [`${prefix}:minute`, `${prefix}:day:${day}`, `${prefix}:surfaces:${day}`];
  const args = [
    String(minuteLimit),
    String(dailyLimit),
    "60",
    String(secondsUntilUtcDayEnd(now)),
    input.surface,
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

/**
 * How much of today's AI allowance is left, without spending any of it.
 *
 * Someone about to approve six tests should be able to see what that leaves,
 * and finding out by being refused halfway through is the worst way to learn
 * it. Reads the same counter the reservation increments, so the number shown
 * is the number that will be enforced.
 */
/** What one surface spent today, for the question "spent on what?". */
export type AiSurfaceSpend = { surface: string; used: number };

export async function readOrganizationAiAllowance(input: {
  organizationId: string;
  source?: EnvironmentSource;
  now?: Date;
  read?: (key: string) => Promise<unknown>;
  /** The per-surface tally, kept beside the total the reservation increments. */
  readSurfaces?: (key: string) => Promise<Record<string, unknown> | null>;
  resolveLimits?: typeof getOrganizationLimits;
}): Promise<{
  dailyLimit: number;
  dailyUsed: number;
  dailyRemaining: number;
  /**
   * Where today's requests went, largest first.
   *
   * A workspace told "today's AI requests are used" could not find out what
   * had used them: the counter was one number and the token figures lived in
   * three different tables and a console log. Empty when the tally cannot be
   * read, which is not the same as nothing having been spent -- the total
   * above is the figure that is enforced either way.
   */
  bySurface: AiSurfaceSpend[];
}> {
  const organizationId = uuid.parse(input.organizationId);
  const source = input.source ?? process.env;
  const now = input.now ?? new Date();
  const limits = await (input.resolveLimits ?? getOrganizationLimits)({ organizationId, now, source });
  const key = `playwrightgen:organization-ai:${organizationId}:day:${now.toISOString().slice(0, 10)}`;
  const read =
    input.read ??
    (async (dayKey: string) => {
      const redisConfig = validateRedisEnvironment(source);
      const redis = new Redis({
        url: redisConfig.UPSTASH_REDIS_REST_URL,
        token: redisConfig.UPSTASH_REDIS_REST_TOKEN,
      });
      return redis.get<number | string | null>(dayKey);
    });
  const surfacesKey = `playwrightgen:organization-ai:${organizationId}:surfaces:${now.toISOString().slice(0, 10)}`;
  const readSurfaces =
    input.readSurfaces ??
    (async (hashKey: string) => {
      const redisConfig = validateRedisEnvironment(source);
      const redis = new Redis({
        url: redisConfig.UPSTASH_REDIS_REST_URL,
        token: redisConfig.UPSTASH_REDIS_REST_TOKEN,
      });
      return redis.hgetall<Record<string, unknown>>(hashKey);
    });

  const raw = await read(key);
  const dailyUsed = Math.max(0, Number(raw ?? 0) || 0);
  // Never at the cost of the number that matters: the allowance is enforced
  // on the total, and a tally that cannot be read must not take the page down
  // with it.
  const tally = await readSurfaces(surfacesKey).catch((error: unknown) => {
    console.error("[organization-ai] the per-surface tally could not be read", error);
    return null;
  });
  const bySurface = Object.entries(tally ?? {})
    .map(([surface, used]) => ({ surface, used: Math.max(0, Number(used ?? 0) || 0) }))
    .filter((entry) => entry.used > 0)
    .sort((left, right) => right.used - left.used || left.surface.localeCompare(right.surface));

  return {
    dailyLimit: limits.aiDailyLimit,
    dailyUsed,
    dailyRemaining: Math.max(0, limits.aiDailyLimit - dailyUsed),
    bySurface,
  };
}
