import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { validateRunnerIngestEnvironment } from "@/lib/env";
import { buildReleaseEvidenceReport } from "@/lib/services/release-evidence";
import { proofTokenHash, readProofToken, readSnapshot } from "@/lib/services/release-proof";

/**
 * A badge that says how much of a project is actually verified.
 *
 * Every repository already carries a badge saying the build passed, which says
 * nothing about whether the product does what it was supposed to do. This one
 * answers that: how many requirements have an approved test that passed, and
 * how many are failing. It is the smallest piece of the evidence, in the place
 * people look first.
 *
 * A badge is public by nature -- a README is read by everyone, and caches and
 * image proxies fetch it -- so it must not be the proof link itself. A badge
 * token is a separate signed statement that carries only the *hash* of the
 * proof token, never the token. It can be checked against the same record, so
 * stopping the link stops the badge, and it cannot be turned back into a link
 * that opens the evidence.
 *
 * Reading a badge is also not a visit: caches fetch it on their own schedule,
 * and counting that as "someone opened your link" would make the one honest
 * signal on the Release page meaningless.
 */

const claimSchema = z.object({
  projectId: z.string().uuid(),
  proofHash: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.number().int().positive(),
});

export type BadgeClaim = z.infer<typeof claimSchema>;

function sign(body: string) {
  const secret = validateRunnerIngestEnvironment().RUNNER_INGEST_SECRET;
  return createHmac("sha256", secret).update(`badge.${body}`).digest("base64url");
}

/** The badge token for a proof link, derived from the link and storing nothing new. */
export function badgeTokenFor(proofToken: string, now: Date = new Date()): string | null {
  const claim = readProofToken(proofToken, now);
  if (!claim) return null;
  const body = Buffer.from(
    JSON.stringify({
      projectId: claim.projectId,
      proofHash: proofTokenHash(proofToken),
      expiresAt: claim.expiresAt,
    } satisfies BadgeClaim),
  ).toString("base64url");
  return `pwgb1.${body}.${sign(body)}`;
}

/** What a badge token claims, or null when we did not sign it or it is spent. */
export function readBadgeToken(token: string, now: Date = new Date()): BadgeClaim | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "pwgb1") return null;
  const [, body, signature] = parts;
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const claim = claimSchema.safeParse(parsed);
  if (!claim.success) return null;
  if (claim.data.expiresAt <= now.getTime()) return null;
  return claim.data;
}

export type BadgeState =
  | { kind: "verified"; verified: number; total: number }
  /** Verified, but some of it by runs nobody has repeated in a month. */
  | { kind: "stale"; verified: number; total: number; stale: number }
  | { kind: "failing"; failing: number }
  | { kind: "unverified" }
  | { kind: "empty" }
  | { kind: "unavailable" };

/**
 * What the badge should say, read through the same record as the link.
 *
 * Never throws and never reveals why: a stopped link, an expired one, a
 * forged token and a project that has gone all produce the same neutral
 * badge.
 */
export async function readBadgeState(
  token: string,
  options: { prisma?: PrismaClient; now?: Date } = {},
): Promise<BadgeState> {
  const now = options.now ?? new Date();
  const claim = readBadgeToken(token, now);
  if (!claim) return { kind: "unavailable" };
  const prisma = options.prisma ?? getPrismaClient();
  const record = await prisma.proofLink
    .findUnique({
      where: { tokenHash: claim.proofHash },
      select: { revokedAt: true, expiresAt: true, projectId: true, organizationId: true, snapshot: true },
    })
    .catch(() => null);
  if (!record || record.revokedAt || record.expiresAt <= now || record.projectId !== claim.projectId) {
    return { kind: "unavailable" };
  }

  const report =
    readSnapshot(record.snapshot) ??
    (await buildReleaseEvidenceReport({
      organizationId: record.organizationId,
      projectId: record.projectId,
      now,
      prisma: options.prisma,
    }).catch(() => null));
  if (!report) return { kind: "unavailable" };

  const { verified, failing, unverified, stale } = report.totals;
  const total = verified + failing + unverified;
  if (total === 0) return { kind: "empty" };
  if (failing > 0) return { kind: "failing", failing };
  if (verified === 0) return { kind: "unverified" };
  // A badge saying "12 of 12 verified" on evidence nobody has repeated in a
  // month is the same lie the page used to tell. It says so instead.
  if (stale > 0) return { kind: "stale", verified, total, stale };
  return { kind: "verified", verified, total };
}

const TONE = {
  verified: "#16a34a",
  stale: "#b45309",
  failing: "#dc2626",
  unverified: "#64748b",
  empty: "#64748b",
  unavailable: "#94a3b8",
} as const;

export function badgeMessage(state: BadgeState) {
  switch (state.kind) {
    case "verified":
      return `${state.verified} of ${state.total} verified`;
    case "stale":
      return `${state.verified} of ${state.total} verified, ${state.stale} stale`;
    case "failing":
      return `${state.failing} failing`;
    case "unverified":
      return "none verified";
    case "empty":
      return "no requirements";
    case "unavailable":
      return "unavailable";
  }
}

/** Roughly how wide 11px DejaVu Sans renders, which is what badges are measured in. */
function width(text: string) {
  return Math.round(text.length * 6.2) + 20;
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The badge itself: flat, two-part, and readable at the size a README shows
 * it. Drawn rather than fetched, so nothing about the project leaves in a
 * request to a badge service.
 */
export function badgeSvg(state: BadgeState, label = "requirements") {
  const message = badgeMessage(state);
  const labelWidth = width(label);
  const messageWidth = width(message);
  const total = labelWidth + messageWidth;
  const tone = TONE[state.kind];
  const title = `${label}: ${message}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escape(title)}">
  <title>${escape(title)}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".1" stop-color="#aaa" stop-opacity=".1"/><stop offset=".9" stop-color="#000" stop-opacity=".3"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>
  <clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#334155"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="20" fill="${tone}"/>
    <rect width="${total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#000" fill-opacity=".3">${escape(label)}</text>
    <text x="${labelWidth / 2}" y="14">${escape(label)}</text>
    <text x="${labelWidth + messageWidth / 2}" y="15" fill="#000" fill-opacity=".3">${escape(message)}</text>
    <text x="${labelWidth + messageWidth / 2}" y="14">${escape(message)}</text>
  </g>
</svg>
`;
}
