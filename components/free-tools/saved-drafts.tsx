"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";

type DraftSummary = {
  id: string;
  source: string;
  title: string;
  pageUrl: string | null;
  lastRun: { verdict: "passed" | "partial" | "failed"; passed: number; ranAt: string } | null;
  updatedAt: string;
};

export type SavedDraft = {
  id: string;
  title: string;
  pageUrl: string | null;
  code: string;
  payload: unknown;
  lastRun: {
    verdict: "passed" | "partial" | "failed";
    passed: number;
    ranAt: string;
    pageUrl: string;
    receipt: string | null;
  } | null;
};

function hostOf(url: string | null) {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function ago(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const RUN_BADGE = {
  passed: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  partial: "bg-amber-50 text-amber-800 ring-amber-200",
  failed: "bg-red-50 text-red-700 ring-red-200",
} as const;

/**
 * A signed-in person's recent Quick Generate drafts, to reopen one.
 *
 * Each draft keeps the code as it last ran and that run's result, so reopening
 * a passing draft brings its evidence back and it can still go to a project.
 */
export function SavedDrafts({
  refreshKey,
  activeId,
  onOpen,
  source = "quick-generate",
  heading = "Your saved drafts",
}: {
  /** Which tool's saved results to list. */
  source?: "quick-generate" | "coverage-review";
  heading?: string;
  /** Changes whenever the page saved something, so the list reloads. */
  refreshKey: number;
  activeId: string | null;
  onOpen: (draft: SavedDraft) => void;
}) {
  const { isSignedIn } = useAuth();
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    fetch("/api/free-tool-drafts", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { drafts: [] }))
      .then((data: { drafts?: DraftSummary[] }) => {
        if (!cancelled) setDrafts((data.drafts ?? []).filter((draft) => draft.source === source));
      })
      .catch(() => {
        if (!cancelled) setDrafts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, refreshKey, source]);

  if (!isSignedIn || !drafts || drafts.length === 0) return null;

  async function open(id: string) {
    setOpening(id);
    setError("");
    try {
      const response = await fetch(`/api/free-tool-drafts/${id}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "That draft could not be opened.");
        return;
      }
      onOpen(data.draft);
    } catch {
      setError("Could not reach the service.");
    } finally {
      setOpening(null);
    }
  }

  async function remove(id: string) {
    setDrafts((current) => current?.filter((draft) => draft.id !== id) ?? null);
    await fetch(`/api/free-tool-drafts/${id}`, { method: "DELETE" }).catch(() => undefined);
  }

  const visible = showAll ? drafts : drafts.slice(0, 4);
  return (
    <section aria-labelledby="saved-drafts-heading" className="mt-6 rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="saved-drafts-heading" className="text-sm font-bold text-slate-950">
          {heading} <span className="font-medium text-slate-400">&middot; {drafts.length}</span>
        </h2>
        <p className="text-xs text-slate-500">Kept with your account, with the last live run.</p>
      </div>
      <ul className="mt-4 divide-y divide-slate-100">
        {visible.map((draft) => (
          <li key={draft.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                {draft.title}
                {draft.id === activeId ? <span className="ml-2 text-xs font-medium text-cyan-700">open now</span> : null}
              </p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                {hostOf(draft.pageUrl) ? <span>{hostOf(draft.pageUrl)}</span> : null}
                <span>{ago(draft.updatedAt)}</span>
                {draft.lastRun ? (
                  <span className={`rounded-full px-2 py-0.5 font-semibold ring-1 ${RUN_BADGE[draft.lastRun.verdict]}`}>
                    {draft.lastRun.verdict === "passed"
                      ? `Passed · ${draft.lastRun.passed} checks`
                      : draft.lastRun.verdict === "partial"
                        ? `Partly run · ${draft.lastRun.passed} passed`
                        : "Failed on the live page"}
                  </span>
                ) : (
                  <span>Not run yet</span>
                )}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={() => open(draft.id)}
                disabled={opening !== null}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-800 hover:border-cyan-400 hover:bg-cyan-50 disabled:opacity-50"
              >
                {opening === draft.id ? "Opening…" : "Open"}
              </button>
              <button
                type="button"
                onClick={() => remove(draft.id)}
                aria-label={`Delete ${draft.title}`}
                className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-400 hover:text-red-600"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {drafts.length > 4 ? (
        <button type="button" onClick={() => setShowAll((value) => !value)} className="mt-2 text-xs font-semibold text-cyan-800 hover:text-cyan-950">
          {showAll ? "Show fewer" : `Show all ${drafts.length}`}
        </button>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-xs text-red-600">{error}</p> : null}
    </section>
  );
}
