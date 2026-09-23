import { NextResponse } from "next/server";
import { z } from "zod";

import { EnvironmentValidationError } from "@/lib/env";
import { readFreeToolAllowance } from "@/lib/operations/free-tool-access";

export const runtime = "nodejs";

/**
 * What this caller has left for a free tool today.
 *
 * The tools used to say "you have used today's allowance" only after the
 * click, which reads as a fault rather than a limit. This answers the same
 * question before it, and uses nothing: it reads the counters the reservation
 * increments. A caller cannot ask about anyone else, because the visitor's
 * count is keyed by their own address and the workspace's by their session.
 */
const surfaceSchema = z.enum(["quick-generate", "coverage-review", "release-review"]);

export async function GET(request: Request) {
  const surface = surfaceSchema.safeParse(new URL(request.url).searchParams.get("surface"));
  if (!surface.success) {
    return NextResponse.json({ error: "Unknown tool." }, { status: 400 });
  }
  try {
    const allowance = await readFreeToolAllowance({ request, surface: surface.data });
    return NextResponse.json(allowance, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // Never block a tool because the count could not be read.
    if (!(error instanceof EnvironmentValidationError)) {
      console.error("[free-tool-allowance] could not read the allowance", error);
    }
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
