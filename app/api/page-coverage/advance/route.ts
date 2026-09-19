import { NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspaceContext, WorkspaceAuthorizationError } from "@/lib/auth/workspace-context";
import { PageCoverageError, proveNextPageCoverageItem } from "@/lib/services/page-coverage";

export const runtime = "nodejs";
// One item: read the page, write the test, run it, fix it up to twice.
export const maxDuration = 300;

const bodySchema = z.object({
  orgSlug: z.string().min(1).max(200),
  projectId: z.string().uuid(),
  coverageId: z.string().uuid(),
});

/**
 * Proves the next queued test of a "cover this page" plan. The progress page
 * calls this until nothing is left, so no single request runs longer than one
 * item takes.
 */
export async function POST(request: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Send the workspace, project and plan." }, { status: 400 });
  }
  try {
    await requireWorkspaceContext({ orgSlug: body.orgSlug, projectId: body.projectId, permission: "testcase:create" });
    const outcome = await proveNextPageCoverageItem(body);
    return NextResponse.json(outcome, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError) {
      return NextResponse.json({ error: "Your role in this project does not allow that." }, { status: error.status });
    }
    if (error instanceof PageCoverageError) {
      return NextResponse.json({ error: error.detail ?? error.code }, { status: error.code === "not_found" ? 404 : 409 });
    }
    console.error("[page-coverage] advance failed", error);
    return NextResponse.json({ error: "The next test could not be proven. It will be tried again." }, { status: 500 });
  }
}
