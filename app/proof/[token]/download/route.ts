import { NextResponse } from "next/server";

import { evidenceDocument, evidenceFileName } from "@/lib/services/evidence-document";
import { readLinkSignatures } from "@/lib/services/evidence-signature";
import { buildReleaseEvidenceReport } from "@/lib/services/release-evidence";
import { EXAMPLE_PROOF_TOKEN, exampleProofClaim, resolveProofLink } from "@/lib/services/release-proof";

/**
 * The shared evidence as a file the reader can keep.
 *
 * Same permission as the page itself -- the signed link is the permission, and
 * a stopped or expired one downloads nothing. A snapshot link exports what it
 * kept; a live link exports what it reads now, and the document says which.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // The published example downloads like any other evidence: a reader who
  // would keep the file is the reader this page is for.
  const example = token === EXAMPLE_PROOF_TOKEN ? exampleProofClaim() : null;
  const claim = example ? { ...example, snapshot: null } : await resolveProofLink(decodeURIComponent(token));
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
  // Null, not an empty list: a blip while this file is produced must not
  // turn into a record that reads as though nobody accepted anything.
  const signatures = example ? [] : await readLinkSignatures(decodeURIComponent(token)).catch(() => null);
  // One link cannot hold more acceptances than signing allows on it, so the
  // listing is never a truncated view of a longer list and the total is the
  // number in hand. No count query is needed to say so honestly.
  const accepted = signatures === null ? null : { items: signatures, total: signatures.length };

  return new NextResponse(
    evidenceDocument(report, {
      frozen: Boolean(claim.snapshot),
      signatures: accepted,
      // This file knows this link's acceptances and no others, and says so
      // rather than leaving a reader to read silence as nobody.
      signatureScope: "link",
    }),
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `attachment; filename="${evidenceFileName(report)}"`,
        // A shared record should not be indexed or cached by anything between.
        "x-robots-tag": "noindex",
        "cache-control": "no-store",
      },
    },
  );
}
