import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Tokens that let a person's code editor read one project.
 *
 * An editor's AI assistant -- Copilot, Cursor, Claude Code -- connects to
 * PlaywrightGen over MCP and reads approved test cases and approved automation
 * so it can write them into the repository. The token is what it presents.
 *
 * Like the CI token it is derived, not stored: nothing secret sits in the
 * database, and advancing the project's token version revokes every token for
 * that project at once. Unlike the CI token it names a person. A token belongs
 * to one user in one project and is honoured only while that user can still
 * read the project, so taking someone off the Team page disconnects their
 * editor on its next request with nothing else to remember to revoke.
 *
 * The project and user ids travel inside the token so a request can be
 * verified without searching for it. They are identifiers, not secrets; the
 * MAC is the only part that grants anything, and it binds the organization
 * too, so a token cannot be replayed against another tenant.
 */

const PREFIX = "pwg1";
const tokenPattern = /^pwg1\.([0-9a-f]{32})\.([0-9a-f]{32})\.([A-Za-z0-9_-]{43})$/;

function compact(uuid: string) {
  return uuid.replace(/-/g, "").toLowerCase();
}

function expand(hex: string) {
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mac(input: {
  secret: string;
  organizationId: string;
  projectId: string;
  userId: string;
  tokenVersion: number;
}) {
  return createHmac("sha256", input.secret)
    .update(
      `pwg:editor:v1:${input.organizationId}:${input.projectId}:${input.userId}:${input.tokenVersion}`,
    )
    .digest("base64url");
}

export function deriveEditorToken(input: {
  secret: string;
  organizationId: string;
  projectId: string;
  userId: string;
  tokenVersion: number;
}): string {
  return `${PREFIX}.${compact(input.projectId)}.${compact(input.userId)}.${mac(input)}`;
}

/** Reads who a token claims to be. Claims only: nothing is verified here. */
export function parseEditorToken(
  token: string,
): { projectId: string; userId: string } | null {
  const match = token.trim().match(tokenPattern);
  if (!match) return null;
  return { projectId: expand(match[1]), userId: expand(match[2]) };
}

export function editorTokenMatches(input: {
  presented: string;
  secret: string;
  organizationId: string;
  projectId: string;
  userId: string;
  tokenVersion: number;
}): boolean {
  const expected = Buffer.from(deriveEditorToken(input));
  const received = Buffer.from(input.presented.trim());
  return expected.length === received.length && timingSafeEqual(expected, received);
}
