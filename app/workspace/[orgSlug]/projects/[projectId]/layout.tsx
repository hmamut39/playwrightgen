import { notFound } from "next/navigation";

import { isProjectId } from "@/lib/auth/workspace-context";

/**
 * An address that could not be a project is not found, not broken.
 *
 * Every tab under a project resolves the id through its own service, and each
 * of those validates the id and *throws* before the workspace lookup gets a
 * chance to answer "no such project". A thrown validation error is a 500, and
 * what the reader sees is:
 *
 *   "This page didn't load. If you just created your workspace, it may still
 *    be finishing setup. Trying again usually works."
 *
 * Every word of that is false for a mistyped or stale URL. Nothing is
 * finishing setup, and trying again will never work -- so a person waits,
 * retries, and concludes the product is broken when the address is simply
 * wrong. It also means anybody can fill the error log by typing a URL.
 *
 * A layout runs before the page it wraps, so one check here covers all
 * nineteen tabs without touching any of them, and without a second database
 * query: this is shape only. Whether the project exists, and whether this
 * person may see it, stay the database's answer, asked a moment later.
 *
 * Found on 2026-11-21 while walking the workspace as a new member, when a
 * script followed /projects/new as though it were an id.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  if (!isProjectId(projectId)) {
    notFound();
  }
  return children;
}
