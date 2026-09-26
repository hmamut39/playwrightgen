import { NextResponse } from "next/server";

import { evidenceDocument, evidenceFileName } from "@/lib/services/evidence-document";
import { listEvidenceSignatures } from "@/lib/services/evidence-signature";
import { getReleaseEvidenceReport } from "@/lib/services/release-evidence";

/**
 * The team's own copy of the evidence, without sharing a link first.
 *
 * Someone answering an auditor usually wants the file, not a URL to hand out.
 * This is the same document a proof link exports, built for the signed-in
 * reader and scoped by their workspace context, so it needs no token and
 * grants no one else access.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; projectId: string }> },
) {
  const { orgSlug, projectId } = await params;
  const report = await getReleaseEvidenceReport({ orgSlug, projectId });
  const signatures = await listEvidenceSignatures({ orgSlug, projectId }).catch(() => []);
  return new NextResponse(evidenceDocument(report, { signatures }), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${evidenceFileName(report)}"`,
      "cache-control": "no-store",
    },
  });
}
