import "server-only";

import { auth } from "@clerk/nextjs/server";

/**
 * The signed-in person's Clerk user id, or null for a visitor.
 *
 * For personal data that lives outside any workspace -- a person's own
 * free-tool history -- where the only question is who is asking. The route
 * must be listed in the middleware matcher, or auth() cannot read the session;
 * a missing session is treated as a visitor rather than an error.
 */
export async function readSignedInUserId(): Promise<string | null> {
  try {
    const { userId } = await auth();
    return userId ?? null;
  } catch {
    return null;
  }
}
