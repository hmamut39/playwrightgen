import "server-only";

import { Redis } from "@upstash/redis";

import { getPrismaClient } from "@/lib/db/prisma";
import { validateRedisEnvironment } from "@/lib/env";

/**
 * Liveness of the dependencies the product cannot work without.
 *
 * This exists because of a real incident: the Upstash database backing every
 * rate-limit guard was reclaimed after months of inactivity, its hostname
 * stopped resolving, and four features failed for an unknown length of time.
 * The site kept returning 200 on every page, so nothing looked wrong. It
 * surfaced only because someone happened to exercise an endpoint by hand.
 *
 * Two rules shape what this reports.
 *
 * It states what it actually checked. A component is only "up" if a real
 * round trip succeeded; configuration being present is reported as
 * "configured", never as healthy, because a key that exists and a key that
 * works are different things and conflating them is how the last outage hid.
 *
 * It leaks nothing. Component names, states, and latencies only — no
 * hostnames, no error text, no versions. An unauthenticated caller learns
 * whether the service is usable, not how it is built.
 */

export const HEALTH_CACHE_MS = 15_000;

export type ComponentState = "up" | "down" | "configured" | "missing";

export type ComponentHealth = {
  name: string;
  state: ComponentState;
  /** Round-trip milliseconds, present only when a call was actually made. */
  latencyMs?: number;
  /** Whether the product is unusable when this component is down. */
  critical: boolean;
};

export type HealthReport = {
  status: "healthy" | "degraded";
  checkedAt: string;
  components: ComponentHealth[];
};

type Cached = { report: HealthReport; expiresAt: number };
let cached: Cached | null = null;

/**
 * Probes are injectable so the report can be tested without a database, a Redis
 * instance, or a network. A health check that can only be exercised against
 * live infrastructure is one nobody verifies until it is already wrong.
 */
export type HealthDependencies = {
  probeDatabase?: () => Promise<ComponentHealth>;
  probeRedis?: () => Promise<ComponentHealth>;
  source?: Readonly<Record<string, string | undefined>>;
};

async function timed(
  name: string,
  critical: boolean,
  probe: () => Promise<unknown>,
): Promise<ComponentHealth> {
  const startedAt = Date.now();
  try {
    await probe();
    return { name, state: "up", latencyMs: Date.now() - startedAt, critical };
  } catch {
    // The reason is deliberately discarded rather than reported. A failing
    // dependency's error text routinely contains hostnames and credentials.
    return { name, state: "down", latencyMs: Date.now() - startedAt, critical };
  }
}

async function checkDatabase(): Promise<ComponentHealth> {
  return timed("database", true, () => getPrismaClient().$queryRaw`SELECT 1`);
}

async function checkRedis(): Promise<ComponentHealth> {
  let config: ReturnType<typeof validateRedisEnvironment>;
  try {
    config = validateRedisEnvironment();
  } catch {
    return { name: "redis", state: "missing", critical: true };
  }
  return timed("redis", true, async () => {
    const redis = new Redis({
      url: config.UPSTASH_REDIS_REST_URL,
      token: config.UPSTASH_REDIS_REST_TOKEN,
    });
    const value = await redis.ping();
    if (typeof value !== "string") throw new Error("unexpected ping response");
  });
}

/**
 * Reported as configuration only. Calling the provider on every health check
 * would bill real money for monitoring and hand an unauthenticated caller a way
 * to spend it, so a genuine provider round trip belongs in the eval suite
 * rather than here.
 */
function checkProvider(name: string, present: boolean, critical: boolean): ComponentHealth {
  return { name, state: present ? "configured" : "missing", critical };
}

export async function getHealthReport(
  now = Date.now(),
  dependencies: HealthDependencies = {},
): Promise<HealthReport> {
  if (cached && cached.expiresAt > now) return cached.report;

  const source = dependencies.source ?? process.env;
  const [database, redis] = await Promise.all([
    (dependencies.probeDatabase ?? checkDatabase)(),
    (dependencies.probeRedis ?? checkRedis)(),
  ]);

  const components: ComponentHealth[] = [
    database,
    redis,
    checkProvider("openai", Boolean(source.OPENAI_API_KEY?.trim()), true),
    checkProvider("clerk", Boolean(source.CLERK_SECRET_KEY?.trim()), true),
    checkProvider("runner-ingest", Boolean(source.RUNNER_INGEST_SECRET?.trim()), false),
  ];

  const report: HealthReport = {
    status: components.some((c) => c.critical && (c.state === "down" || c.state === "missing"))
      ? "degraded"
      : "healthy",
    checkedAt: new Date(now).toISOString(),
    components,
  };

  // Cached because this endpoint is public and unauthenticated: without a
  // bound, repeated calls would turn a monitoring aid into a way to load the
  // database and Redis for free.
  cached = { report, expiresAt: now + HEALTH_CACHE_MS };
  return report;
}

/** Test seam; the cache is module state that would otherwise leak between cases. */
export function resetHealthCache(): void {
  cached = null;
}
