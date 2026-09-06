import { NextResponse } from "next/server";

import { getHealthReport, HEALTH_CACHE_MS } from "@/lib/operations/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public liveness of the dependencies the product needs.
 *
 * Deliberately unauthenticated: a health check that requires a credential is
 * useless to the uptime monitor that is supposed to notice an outage before a
 * customer does. It is safe to expose because it returns component names and
 * states only, never hostnames, error text, or versions, and because the report
 * is cached, so repeated calls cannot be used to load the database and Redis.
 *
 * A degraded report answers 503 rather than 200. Monitors alert on status
 * codes, and a service that returns 200 while its dependencies are down is
 * exactly the failure this endpoint exists to prevent.
 */
export async function GET() {
  const report = await getHealthReport();

  return NextResponse.json(report, {
    status: report.status === "healthy" ? 200 : 503,
    headers: {
      "cache-control": `public, max-age=${Math.floor(HEALTH_CACHE_MS / 1000)}`,
    },
  });
}
