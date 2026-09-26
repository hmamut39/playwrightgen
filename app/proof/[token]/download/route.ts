import { NextResponse } from "next/server";

import { evidenceDocument, evidenceFileName } from "@/lib/services/evidence-document";
import { readLinkSignatures } from "@/lib/services/evidence-signature";
import { buildReleaseEvidenceReport } from "@/lib/services/release-evidence";
import { resolveProofLink } from "@/lib/services/release-proof";

/**
 * The shared evidence as a file the reader can keep.
 *
 * Same permission as the page itself -- the signed link is the permission, and
 * a stopped or expired one downloads nothing. A snapshot link exports what it
 * kept; a live link exports what it reads now, and the document says which.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const claim = await resolveProofLink(decodeURIComponent(token));
  if (!claim) return new NextResponse("This link is no longer valid.", { status: 404 });

  const report =
    claim.snapshot ??
    (await buildReleaseEvidenceReport({
      organizationId: claim.organizationId,
      projectId: claim.projectId,
    }).catch(() => null));
  if (!report) return new NextResponse("This link is no longer valid.", { status: 404 });

  // Whoever accepted this evidence belongs in the file that is kept, not only
  // on the page that expires.
  const signatures = await readLinkSignatures(decodeURIComponent(token)).catch(() => []);

  return new NextResponse(evidenceDocument(report, { frozen: Boolean(claim.snapshot), signatures }), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="${evidenceFileName(report)}"`,
      // A shared record should not be indexed or cached by anything in between.
      "x-robots-tag": "noindex",
      "cache-control": "no-store",
    },
  });
}
