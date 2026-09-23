"use client";

import { useEffect } from "react";

/**
 * How many free runs are left today, asked before anything is spent.
 *
 * A tool that only learns its limit from a refusal tells the person "you have
 * used today's allowance" at the worst moment: after they filled the form and
 * pressed the button. This asks on load, and once a real run answers with its
 * own count that count wins, so the number never goes backwards.
 */
export function useFreeToolAllowance(
  surface: "quick-generate" | "coverage-review" | "release-review",
  apply: (allowance: { remaining: number; limit: number; plan: "TEAM" | "PUBLIC" }) => void,
) {
  useEffect(() => {
    const aborter = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/free-tool-allowance?surface=${surface}`, { signal: aborter.signal });
        if (!response.ok) return;
        const data: unknown = await response.json();
        if (
          data &&
          typeof data === "object" &&
          typeof (data as { remaining?: unknown }).remaining === "number" &&
          typeof (data as { limit?: unknown }).limit === "number"
        ) {
          apply(data as { remaining: number; limit: number; plan: "TEAM" | "PUBLIC" });
        }
      } catch {
        // Offline, blocked, or the counter is unavailable: the tool still works,
        // and the limit is enforced by the run itself either way.
      }
    })();
    return () => aborter.abort();
    // Asked once per surface; `apply` only writes state that a run overwrites.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface]);
}
