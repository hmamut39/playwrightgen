"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Keeps a "cover this page" plan moving while this page is open.
 *
 * Each call proves one test on the server, so no request runs longer than a
 * server allows; two run side by side to halve the wait. The page refreshes
 * after each, so finished tests appear as they finish. Closing the tab pauses
 * the work, and it carries on from where it was when the page is opened again.
 */
export function PageCoverageDriver({
  orgSlug,
  projectId,
  coverageId,
}: {
  orgSlug: string;
  projectId: string;
  coverageId: string;
}) {
  const router = useRouter();
  const [problem, setProblem] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let stopped = false;

    const worker = async () => {
      let failures = 0;
      while (!stopped) {
        try {
          const response = await fetch("/api/page-coverage/advance", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ orgSlug, projectId, coverageId }),
          });
          const data = await response.json();
          if (!response.ok) {
            failures += 1;
            setProblem(data.error || "A test could not be proven; trying again.");
            if (failures >= 3 || response.status < 500) return;
            continue;
          }
          failures = 0;
          setProblem("");
          router.refresh();
          if (data.status !== "PROVING" || (!data.provedItemId && data.remaining > 0)) {
            // Paused, done, or the other worker holds the last item.
            if (data.status !== "PROVING" || data.remaining === 0) return;
            await new Promise((resolve) => setTimeout(resolve, 5_000));
          }
          if (data.remaining === 0) return;
        } catch {
          failures += 1;
          setProblem("Lost the connection; trying again.");
          if (failures >= 3) return;
          await new Promise((resolve) => setTimeout(resolve, 3_000));
        }
      }
    };

    void Promise.all([worker(), worker()]).then(() => router.refresh());
    return () => {
      stopped = true;
    };
  }, [orgSlug, projectId, coverageId, router]);

  return (
    <p role="status" aria-live="polite" className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
      Proving the tests, two at a time &mdash; each takes about a minute. Keep this page open; if you close it, it carries on
      from here when you come back.
      {problem ? <span className="mt-1 block text-amber-800">{problem}</span> : null}
    </p>
  );
}
