import "server-only";

import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { evidenceHash, legacyEvidenceHash } from "@/lib/services/evidence-hash";
import { buildReleaseEvidenceReport, type ReleaseEvidenceReport } from "@/lib/services/release-evidence";
import { proofTokenHash, readProofToken, readSnapshot } from "@/lib/services/release-proof";

/**
 * Somebody outside the team accepting the evidence in front of them.
 *
 * Every audit chain ends at a person saying "yes, this is acceptable". In most
 * teams that moment happens in a meeting or an email, and the record of it --
 * if there is one -- sits apart from the evidence it was about, so a year
 * later nobody can say what exactly was accepted. A proof link already puts
 * the evidence in front of that person. This keeps their answer next to it.
 *
 * Two rules make the record worth having.
 *
 * It is bound to what was on the screen. The report is hashed at the moment of
 * signing and a copy is kept, so a later reader can tell whether what they are
 * looking at is what was accepted, rather than trusting that nothing moved.
 *
 * It does not pretend to be more than it is. The name is what the signer
 * typed; the product does not know who held the link. The record says a named
 * person accepted this evidence, not that their identity was proven -- and the
 * page says so too. What it does have is a link sent to someone, which expires
 * and can be stopped, and a signature that cannot be moved to other evidence.
 */

const MAX_PER_LINK = 20;

export class EvidenceSignatureError extends Error {
  constructor(readonly code: "link_invalid" | "too_many" | "invalid_input") {
    super(code);
    this.name = "EvidenceSignatureError";
  }
}

const inputSchema = z.object({
  signedName: z.string().trim().min(1).max(120),
  signedRole: z.string().trim().max(120).optional(),
  note: z.string().trim().max(2_000).optional(),
});

/**
 * Records an acceptance against a live proof link.
 *
 * Signing is the one thing a link holder may write, so it goes through the
 * same check as opening: a stopped or expired link signs nothing.
 */
export async function signEvidence(
  token: string,
  input: { signedName: string; signedRole?: string; note?: string },
  options: { prisma?: PrismaClient; now?: Date } = {},
) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new EvidenceSignatureError("invalid_input");

  const now = options.now ?? new Date();
  const claim = readProofToken(token, now);
  if (!claim) throw new EvidenceSignatureError("link_invalid");
  const prisma = options.prisma ?? getPrismaClient();
  const record = await prisma.proofLink.findUnique({
    where: { tokenHash: proofTokenHash(token) },
    select: { id: true, revokedAt: true, expiresAt: true, projectId: true, organizationId: true, snapshot: true },
  });
  if (!record || record.revokedAt || record.expiresAt <= now || record.projectId !== claim.projectId) {
    throw new EvidenceSignatureError("link_invalid");
  }

  const signed = await prisma.evidenceSignature.count({ where: { proofLinkId: record.id } });
  // A link is sent to a handful of people, not a petition.
  if (signed >= MAX_PER_LINK) throw new EvidenceSignatureError("too_many");

  const report =
    readSnapshot(record.snapshot) ??
    (await buildReleaseEvidenceReport({
      organizationId: record.organizationId,
      projectId: record.projectId,
      now,
      prisma: options.prisma,
    }).catch(() => null));
  if (!report) throw new EvidenceSignatureError("link_invalid");

  return prisma.evidenceSignature.create({
    data: {
      organizationId: record.organizationId,
      projectId: record.projectId,
      proofLinkId: record.id,
      signedName: parsed.data.signedName,
      signedRole: parsed.data.signedRole || null,
      note: parsed.data.note || null,
      evidenceHash: evidenceHash(report),
      evidence: JSON.parse(JSON.stringify(report)) as object,
      signedAt: now,
    },
    select: { id: true, signedName: true, signedRole: true, signedAt: true, evidenceHash: true },
  });
}

/** Signatures already on this link, for whoever opens it next. */
export async function readLinkSignatures(
  token: string,
  options: { prisma?: PrismaClient; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  if (!readProofToken(token, now)) return [];
  const prisma = options.prisma ?? getPrismaClient();
  const record = await prisma.proofLink.findUnique({
    where: { tokenHash: proofTokenHash(token) },
    select: { id: true, revokedAt: true },
  });
  if (!record || record.revokedAt) return [];
  return prisma.evidenceSignature.findMany({
    where: { proofLinkId: record.id },
    orderBy: { signedAt: "asc" },
    select: { id: true, signedName: true, signedRole: true, note: true, signedAt: true, evidenceHash: true },
    take: MAX_PER_LINK,
  });
}

/** Every acceptance recorded for this project, newest first. */
/**
 * How many acceptances a listing shows at once.
 *
 * Bounded so a long-running project returns a page rather than everything
 * it ever recorded. The bound is only honest if whoever reads the list is
 * told it exists: the compliance pack showed fifty and implied they were
 * all of them, which is the same overstatement the evidence report was
 * carrying until its own cap was surfaced.
 */
const SIGNATURE_PAGE = 50;

export async function listEvidenceSignatures(
  input: { orgSlug?: string; projectId: string },
  dependencies?: WorkspaceContextDependencies & { prisma?: PrismaClient },
) {
  const projectId = z.string().uuid().parse(input.projectId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "testrun:read" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();
  const where = { organizationId: workspace.organization.id, projectId };
  const [items, total] = await Promise.all([
    prisma.evidenceSignature.findMany({
      where,
      orderBy: { signedAt: "desc" },
      select: {
        id: true,
        signedName: true,
        signedRole: true,
        note: true,
        signedAt: true,
        evidenceHash: true,
        evidence: true,
      },
      take: SIGNATURE_PAGE,
    }),
    prisma.evidenceSignature.count({ where }),
  ]);

  // The total travels with the page, so no surface has to know the cap to
  // say whether it is holding all of them.
  return { items, total };
}

/**
 * Whether what is on screen now is what was accepted.
 *
 * The honest answer a reader needs a year later: the signature says a named
 * person accepted evidence with this hash, and this is whether the project
 * still matches it.
 */
export function stillMatches(signature: { evidenceHash: string }, report: ReleaseEvidenceReport) {
  if (signature.evidenceHash === evidenceHash(report)) return true;
  /*
   * A signature recorded before the report carried approved tests that verify
   * no requirement was given over a page that did not show them. What that
   * person accepted is the requirements, so that is what "has it changed"
   * must mean for their signature -- and if the requirements still match,
   * nothing they were shown has changed.
   *
   * Only their signature. Anything accepted from here on is hashed over the
   * whole page, so an unlinked test that stops passing is reported as a
   * change to whoever accepted it.
   */
  return signature.evidenceHash === legacyEvidenceHash(report);
}
