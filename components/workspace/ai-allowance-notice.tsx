import Link from "next/link";

import { AutomationArtifactDomainError } from "@/lib/services/automation-artifacts";

/**
 * Which notice a generation refused by the workspace's AI allowance should
 * show, or null for any other failure. Server actions redirect back with it
 * as `?notice=`, so the person reads why nothing was generated instead of a
 * "This page didn't load" screen.
 */
export function aiAllowanceNotice(error: unknown): "ai-daily" | "ai-burst" | null {
  if (!(error instanceof AutomationArtifactDomainError)) return null;
  if (error.code === "organization_daily_limit") return "ai-daily";
  if (error.code === "organization_burst_limit") return "ai-burst";
  return null;
}

export function AiAllowanceNotice({ notice, orgSlug }: { notice: string | undefined; orgSlug: string }) {
  if (notice !== "ai-daily" && notice !== "ai-burst") return null;
  return (
    <div role="alert" className="mt-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      {notice === "ai-daily" ? (
        <>
          <span className="font-semibold">Nothing was generated: this workspace has used today&rsquo;s AI allowance.</span>{" "}
          It resets at midnight UTC.{" "}
          <Link href={`/workspace/${orgSlug}/billing`} className="font-semibold underline">
            The Team plan raises it.
          </Link>
        </>
      ) : (
        <span className="font-semibold">Too many AI requests in a minute. Wait a minute and try again.</span>
      )}
    </div>
  );
}
