"use client";

import { useState } from "react";

type OperationResult = { source: string; status: "passed" | "failed" | "skipped" | "not_reached"; detail?: string };
type StepResult = { name: string; status: "passed" | "failed" | "partial" | "not_reached"; operations: OperationResult[] };
type TestResult = {
  name: string;
  status: "passed" | "failed" | "incomplete";
  steps: StepResult[];
  failureScreenshot?: string;
};
type RunResult = {
  tests: TestResult[];
  counts: { passed: number; failed: number; skipped: number; notReached: number };
  durationMs: number;
  timedOut: boolean;
};

const STATUS_ICON: Record<OperationResult["status"], { icon: string; tone: string; label: string }> = {
  passed: { icon: "✓", tone: "text-emerald-400", label: "passed" },
  failed: { icon: "✗", tone: "text-red-400", label: "failed" },
  skipped: { icon: "–", tone: "text-amber-300", label: "not run in the preview" },
  not_reached: { icon: "·", tone: "text-slate-500", label: "not reached" },
};

/**
 * "Does this draft actually work?" answered on the page it was written for.
 *
 * The code is read into steps on the server and replayed in a remote browser;
 * it is never executed as code. The first failure stops the test, as it would
 * in Playwright, and comes back with the reason and a screenshot of the page
 * at that moment -- which is usually all it takes to fix the locator.
 */
export function PreviewRunPanel({ code, pageUrl }: { code: string; pageUrl: string }) {
  const [state, setState] = useState<
    { status: "idle" } | { status: "running" } | { status: "done"; result: RunResult } | { status: "error"; message: string }
  >({ status: "idle" });

  async function run() {
    setState({ status: "running" });
    try {
      const response = await fetch("/api/preview-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, pageUrl }),
      });
      const data = await response.json();
      if (!response.ok) {
        setState({ status: "error", message: data.error || "The live run could not be completed." });
        return;
      }
      setState({ status: "done", result: data.result });
    } catch {
      setState({ status: "error", message: "The live run could not reach the service." });
    }
  }

  const firstFailure =
    state.status === "done"
      ? state.result.tests
          .flatMap((test) => test.steps.map((step) => ({ test, step })))
          .find(({ step }) => step.status === "failed")
      : undefined;
  const failedOperation = firstFailure?.step.operations.find((operation) => operation.status === "failed");

  return (
    <div className="border-t border-white/10 px-5 py-5 text-sm text-slate-300">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="font-semibold text-white">Run it on the live page</p>
          <p className="mt-0.5 text-xs text-slate-400">
            Replays each step in a real browser against {new URL(pageUrl).host}. Nothing is executed on our servers.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={state.status === "running"}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 text-sm font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
        >
          {state.status === "running" ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
              Running in a real browser&hellip;
            </>
          ) : state.status === "done" ? (
            "Run again"
          ) : (
            "Run on the live page"
          )}
        </button>
      </div>

      {state.status === "error" ? (
        <p role="alert" className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-red-200">{state.message}</p>
      ) : null}

      {state.status === "done" ? (
        <div className="mt-4 space-y-4" aria-live="polite">
          {firstFailure ? (
            <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-4">
              <p className="font-semibold text-red-200">
                Failed at &ldquo;{firstFailure.step.name}&rdquo;
              </p>
              {failedOperation ? (
                <>
                  <code className="mt-2 block overflow-x-auto whitespace-pre font-mono text-xs text-slate-200">{failedOperation.source}</code>
                  <p className="mt-2 text-xs leading-5 text-red-100">{failedOperation.detail}</p>
                </>
              ) : null}
              {firstFailure.test.failureScreenshot ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-red-100">The page at that moment</summary>
                  {/* eslint-disable-next-line @next/next/no-img-element -- a data URL from the run, not a static asset */}
                  <img src={firstFailure.test.failureScreenshot} alt="Screenshot of the page when the step failed" className="mt-2 w-full rounded-lg border border-white/10" />
                </details>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-4 font-semibold text-emerald-200">
              {state.result.counts.skipped > 0
                ? `Every step that could run passed on the live page (${state.result.counts.passed} checks).`
                : `Passed on the live page: ${state.result.counts.passed} checks in ${Math.round(state.result.durationMs / 1000)}s.`}
            </div>
          )}

          <p className="text-xs text-slate-400">
            {state.result.counts.passed} passed &middot; {state.result.counts.failed} failed
            {state.result.counts.skipped ? ` · ${state.result.counts.skipped} not run in the preview` : ""}
            {state.result.counts.notReached ? ` · ${state.result.counts.notReached} not reached` : ""}
            {" "}&middot; {Math.round(state.result.durationMs / 1000)}s
            {state.result.timedOut ? " · stopped at the time limit" : ""}
          </p>

          {state.result.tests.map((test) => (
            <details key={test.name} open={test.status !== "passed"} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <summary className="cursor-pointer text-sm font-semibold text-white">
                {test.status === "passed" ? "✓" : test.status === "failed" ? "✗" : "–"} {test.name}
              </summary>
              <ol className="mt-3 space-y-3">
                {test.steps.map((step) => (
                  <li key={step.name}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{step.name}</p>
                    <ul className="mt-1 space-y-1">
                      {step.operations.map((operation, index) => (
                        <li key={`${step.name}-${index}`} className="flex gap-2 font-mono text-xs">
                          <span className={STATUS_ICON[operation.status].tone} title={STATUS_ICON[operation.status].label}>
                            {STATUS_ICON[operation.status].icon}
                          </span>
                          <span className={operation.status === "not_reached" ? "text-slate-500" : "text-slate-200"}>
                            {operation.source}
                            {operation.status === "skipped" && operation.detail ? (
                              <span className="ml-2 font-sans text-amber-200/80">({operation.detail})</span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            </details>
          ))}
          <p className="text-xs leading-5 text-slate-500">
            The preview runs signed out, one fresh browser per test, and only runs Playwright steps it can read safely;
            steps that need your environment or data are listed as not run.
          </p>
        </div>
      ) : null}
    </div>
  );
}
