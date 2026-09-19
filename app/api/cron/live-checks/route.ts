import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { runDueLiveChecks } from "@/lib/services/live-checks";

export const runtime = "nodejs";
// A round runs each due project's approved automation in a remote browser.
export const maxDuration = 300;

/**
 * The daily round of live checks, called by the scheduler.
 *
 * Only a request carrying the scheduler's secret (CRON_SECRET, which Vercel
 * sends as a bearer token) is accepted; without the secret configured, nothing
 * runs at all rather than running for anyone.
 */
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const presented = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(presented);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  // Leave a margin under the function limit to write the last result.
  const outcome = await runDueLiveChecks({ budgetMs: 240_000 });
  return NextResponse.json(
    {
      due: outcome.due,
      ran: outcome.ran,
      checked: outcome.rounds.reduce((total, round) => total + (round.summary?.checked ?? 0), 0),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
