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
  needsSignIn = false,
}: {
  orgSlug: string;
  projectId: string;
  coverageId: string;
  /** The page is behind a login: ask for the test account, which is never stored. */
  needsSignIn?: boolean;
}) {
  const [account, setAccount] = useState<{ username: string; password: string } | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const router = useRouter();
  const [problem, setProblem] = useState("");
  const started = useRef(false);

  useEffect(() => {
    if (started.current || (needsSignIn && !account)) return;
    started.current = true;
    let stopped = false;

    const worker = async () => {
      let failures = 0;
      while (!stopped) {
        try {
          const response = await fetch("/api/page-coverage/advance", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ orgSlug, projectId, coverageId, ...(account ? { account } : {}) }),
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
  }, [orgSlug, projectId, coverageId, router, needsSignIn, account]);

  if (needsSignIn && !account) {
    return (
      <form
        className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900"
        onSubmit={(event) => {
          event.preventDefault();
          if (username && password) setAccount({ username, password });
        }}
      >
        <p className="font-semibold">This page is behind a login</p>
        <p className="mt-1 text-xs leading-5">
          Enter the test account again to prove the tests. It is kept in this page only while it is open, and never saved.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input aria-label="Test account username or email" autoComplete="off" value={username} onChange={(event) => setUsername(event.target.value)} maxLength={200} placeholder="Username or email" className="rounded-lg border border-cyan-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-600" />
          <input aria-label="Test account password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={200} placeholder="Password" className="rounded-lg border border-cyan-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-600" />
          <button type="submit" className="rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-800">Start proving</button>
        </div>
      </form>
    );
  }

  return (
    <p role="status" aria-live="polite" className="mt-4 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
      Proving the tests, two at a time &mdash; each takes about a minute. Keep this page open; if you close it, it carries on
      from here when you come back.
      {problem ? <span className="mt-1 block text-amber-800">{problem}</span> : null}
    </p>
  );
}
