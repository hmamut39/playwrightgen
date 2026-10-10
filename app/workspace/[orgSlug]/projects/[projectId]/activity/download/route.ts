import { NextResponse } from "next/server";

import { exportProjectActivity } from "@/lib/services/activity-export";

/**
 * The project's activity trail as a CSV.
 *
 * Same permission as the page it is linked from: the export goes through
 * requireWorkspaceContext with project:read, so it is scoped to one project in
 * one organization and a member of another workspace gets nothing.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; projectId: string }> },
) {
  const { orgSlug, projectId } = await params;

  const exported = await exportProjectActivity({ orgSlug, projectId }).catch(() => null);
  if (!exported) {
    return new NextResponse("That trail could not be read.", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  return new NextResponse(exported.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${exported.filename}"`,
      // It names people and what they approved; nothing in between should keep
      // a copy.
      "x-robots-tag": "noindex",
      "cache-control": "no-store",
    },
  });
}
