import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { sendWeeklyDigests } from "@/lib/services/weekly-digest";

export const runtime = "nodejs";
// A round posts one message per project; the reads are small.
export const maxDuration = 120;

/**
 * The weekly digest round, called by the scheduler.
 *
 * Same rule as the daily checks: only a request carrying the scheduler's
 * secret is accepted, and without the secret configured nothing runs at all
 * rather than running for anyone.
 */
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const outcome = await sendWeeklyDigests({ budgetMs: 90_000 });
  return NextResponse.json(outcome, { headers: { "cache-control": "no-store" } });
}
