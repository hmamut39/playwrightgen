import { NextResponse } from "next/server";

import { readSignedInUserId } from "@/lib/auth/signed-in-user";
import { listFreeToolDrafts } from "@/lib/services/free-tool-drafts";

export const runtime = "nodejs";

/** The signed-in person's recent free-tool drafts, newest first. */
export async function GET() {
  const clerkUserId = await readSignedInUserId();
  if (!clerkUserId) return NextResponse.json({ error: "Sign in to see your saved drafts." }, { status: 401 });
  const drafts = await listFreeToolDrafts(clerkUserId);
  return NextResponse.json({ drafts }, { headers: { "cache-control": "no-store" } });
}
