import { NextResponse } from "next/server";

import { readSignedInUserId } from "@/lib/auth/signed-in-user";
import { deleteFreeToolDraft, getFreeToolDraft } from "@/lib/services/free-tool-drafts";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** One of the signed-in person's drafts, in full, to reopen it. */
export async function GET(_request: Request, { params }: Params) {
  const clerkUserId = await readSignedInUserId();
  if (!clerkUserId) return NextResponse.json({ error: "Sign in to open saved drafts." }, { status: 401 });
  const draft = await getFreeToolDraft(clerkUserId, (await params).id);
  if (!draft) return NextResponse.json({ error: "That draft is no longer saved." }, { status: 404 });
  return NextResponse.json({ draft }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(_request: Request, { params }: Params) {
  const clerkUserId = await readSignedInUserId();
  if (!clerkUserId) return NextResponse.json({ error: "Sign in to manage saved drafts." }, { status: 401 });
  const deleted = await deleteFreeToolDraft(clerkUserId, (await params).id);
  return deleted ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "That draft is no longer saved." }, { status: 404 });
}
