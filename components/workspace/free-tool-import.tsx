"use client";

import Link from "next/link";
import { useActionState, useEffect, useSyncExternalStore } from "react";

import {
  clearFreeToolHandoff,
  peekRunReceipt,
  readFreeToolHandoff,
  saveFreeToolHandoff,
  type FreeToolHandoff,
} from "@/lib/free-tools/handoff";

export type FreeToolImportState = { error: string };

const initialState: FreeToolImportState = { error: "" };
const subscribeToHandoff = () => () => undefined;

const sourceLabels: Record<FreeToolHandoff["source"], string> = {
  "quick-generate": "Quick Generate",
  "coverage-review": "Coverage Review",
  "release-review": "Release Review",
};

export function FreeToolImport({
  projects,
  action,
}: {
  projects: { id: string; name: string; description: string | null }[];
  action: (
    state: FreeToolImportState,
    formData: FormData,
  ) => Promise<FreeToolImportState>;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const handoff = useSyncExternalStore(
    subscribeToHandoff,
    readFreeToolHandoff,
    () => undefined,
  );

  useEffect(() => {
    if (state.error && handoff) saveFreeToolHandoff(handoff);
  }, [handoff, state.error]);

  if (handoff === undefined) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
        Loading your preliminary result…
      </div>
    );
  }

  if (!handoff) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8">
        <h2 className="text-lg font-semibold text-slate-950">No result is waiting to import</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Free-tool handoffs stay in this browser tab for up to 24 hours. Run a
          preliminary review or generation, then choose Continue in Workspace.
        </p>
        <Link href="/generator" className="mt-5 inline-flex rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
          Open Quick Generate
        </Link>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={clearFreeToolHandoff}
      className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <input type="hidden" name="handoff" value={JSON.stringify(handoff)} />

      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">
            {sourceLabels[handoff.source]} → Workspace
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
            Create a real {handoff.target === "TEST_CASE" ? "Test Case" : "Requirement"} draft
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{handoff.notice}</p>
        </div>
        <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
          Human review required
        </span>
      </div>

      <div className="mt-6 grid gap-5">
        <label className="text-sm font-medium text-slate-800">
          Destination project
          <select name="projectId" required className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 outline-none focus:border-cyan-600">
            <option value="">Select a project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        </label>

        <label className="text-sm font-medium text-slate-800">
          Draft title
          <input name="title" required maxLength={300} defaultValue={handoff.title} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-cyan-600" />
        </label>

        <label className="text-sm font-medium text-slate-800">
          {handoff.target === "TEST_CASE" ? "Objective" : "Description"}
          <textarea name="summary" rows={8} maxLength={50_000} defaultValue={handoff.summary} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-cyan-600" />
        </label>

        {handoff.target === "TEST_CASE" ? (
          <label className="text-sm font-medium text-slate-800">
            Steps &mdash; one per line
            <textarea name="steps" rows={6} maxLength={50_000} defaultValue={(handoff.steps ?? []).join("\n")} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-cyan-600" />
          </label>
        ) : null}

        <label className="text-sm font-medium text-slate-800">
          {handoff.target === "TEST_CASE" ? "Expected outcomes — one per line" : "Acceptance criteria"}
          <textarea name="acceptanceCriteria" rows={8} maxLength={50_000} defaultValue={handoff.acceptanceCriteria} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3 outline-none focus:border-cyan-600" />
        </label>
      </div>

      {handoff.target === "TEST_CASE" && handoff.draft ? <AttachedCode draft={handoff.draft} /> : null}

      {state.error ? (
        <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>
      ) : null}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={pending || projects.length === 0}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Creating draft…" : "Create draft in Workspace"}
        </button>
        <Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function AttachedCode({ draft }: { draft: NonNullable<FreeToolHandoff["draft"]> }) {
  const run = peekRunReceipt(draft.receipt);
  const lines = draft.code.split(/\r?\n/).length;
  return (
    <div className={`mt-6 rounded-2xl border p-5 ${run?.verdict === "passed" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}>
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <p className="text-sm font-semibold text-slate-950">Playwright code comes with it &middot; {lines} lines</p>
        <span
          className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${
            run?.verdict === "passed"
              ? "bg-emerald-600 text-white"
              : run?.verdict === "failed"
                ? "bg-red-100 text-red-800"
                : "bg-white text-slate-600 ring-1 ring-slate-200"
          }`}
        >
          {run?.verdict === "passed"
            ? `Passed on the live page · ${run.passed} checks`
            : run?.verdict === "partial"
              ? `Partly run on the live page · ${run.passed} checks passed`
              : run?.verdict === "failed"
                ? "Last live run failed"
                : "Not run on the live page"}
        </span>
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {run
          ? "The run is checked against this exact code when you create the draft, and kept with the Test Case as evidence."
          : "It is kept with the Test Case as an unreviewed draft."}{" "}
        After the Test Case is approved, you can make this code its first automation version instead of generating new code.
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-cyan-800">Show the code</summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">{draft.code}</pre>
      </details>
    </div>
  );
}
