import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { validateRunnerIngestEnvironment } from "@/lib/env";
import { siteUrl } from "@/lib/site";

/**
 * A read-only link that proves what was tested, to someone outside the team.
 *
 * The evidence PlaywrightGen keeps is only worth what it can settle, and the
 * arguments it should settle happen outside the workspace: a manager asking
 * whether the release was tested, a customer asking what "tested" covered, an
 * auditor asking for the record. Until now the answer meant a screenshot or an
 * invitation to the workspace -- one is not evidence, the other gives away
 * everything.
 *
 * A proof link is a signed statement about one project: this project, this
 * moment, expiring. It carries no session, grants nothing else, and the page it
 * opens shows requirements, what verifies them and how they last ran -- never
 * test code, never a way in. Rotating the runner secret revokes every link
 * issued, which is the emergency stop.
 */

const MAX_DAYS = 90;
const payloadSchema = z.object({
  projectId: z.string().uuid(),
  organizationId: z.string().uuid(),
  issuedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
});

export type ProofClaim = z.infer<typeof payloadSchema>;

function secret() {
  return validateRunnerIngestEnvironment().RUNNER_INGEST_SECRET;
}

function sign(body: string) {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

function encode(claim: ProofClaim) {
  const body = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return `pwgp1.${body}.${sign(body)}`;
}

/** The claim a token makes, or null when it is not one we signed, or is spent. */
export function readProofToken(token: string, now: Date = new Date()): ProofClaim | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "pwgp1") return null;
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
  const claim = payloadSchema.safeParse(parsed);
  if (!claim.success) return null;
  if (claim.data.expiresAt <= now.getTime()) return null;
  return claim.data;
}

/**
 * Issues a link for this project. A lead's decision, because it puts the
 * project's evidence in front of people who were never given access.
 */
export async function createProofLink(
  input: { orgSlug?: string; projectId: string; days?: number; now?: Date },
  dependencies?: WorkspaceContextDependencies,
): Promise<{ url: string; expiresAt: Date }> {
  const projectId = z.string().uuid().parse(input.projectId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "project:update" },
    dependencies,
  );
  const days = Math.min(MAX_DAYS, Math.max(1, Math.round(input.days ?? 30)));
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60_000);
  const token = encode({
    projectId,
    organizationId: workspace.organization.id,
    issuedAt: now.getTime(),
    expiresAt: expiresAt.getTime(),
  });
  return { url: `${siteUrl()}/proof/${token}`, expiresAt };
}
