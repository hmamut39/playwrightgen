"use client";

import { useState } from "react";

import { LimitReached, readFreeToolLimit, type FreeToolLimit } from "@/components/free-tools/limit-reached";

export type OperationResult = { source: string; status: "passed" | "failed" | "skipped" | "not_reached"; detail?: string };
export type StepResult = { name: string; status: "passed" | "failed" | "partial" | "not_reached"; operations: OperationResult[] };
export type TestResult = {
  name: string;
  status: "passed" | "failed" | "incomplete";
  steps: StepResult[];
  failureScreenshot?: string;
  failureSnapshot?: string;
};

/** A finished run: the code that ran and the server's signed receipt for it. */
export type CompletedRun = {
  code: string;
  receipt: string | null;
  verdict: "passed" | "partial" | "failed";
  passed: number;
};

export type FixedDraft = {
  code: string;
  explanation: string;
  validation: { status: "PASSED" | "WARNINGS" | "BLOCKED"; findings: { severity: "BLOCKING" | "WARNING"; code: string; message: string }[] };
  locatorCheck: { checked: number; found: number; notFound: string[] };
};
export type RunResult = {
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
export function PreviewRunPanel({
  code,
  pageUrl,
  pageTreeAtStart,
  onFixed,
  onRun,
  draftId,
  initialRun,
  initialEnv,
  onEnvChange,
}: {
  code: string;
  pageUrl: string;
  /** A run that already happened for this code, so its result is shown without running again. */
  initialRun?: RunResult | null;
  /** Values the page already has for process.env names (the test account entered above). */
  initialEnv?: Record<string, string>;
  /** Lets the page keep typed values when a fix replaces the code (and this panel). */
  onEnvChange?: (env: Record<string, string>) => void;
  /** The signed-in person's saved draft; runs and fixes are kept on it. */
  draftId?: string | null;
  pageTreeAtStart?: string;
  /** Receives a corrected draft; the page swaps it in so it can be run again. */
  onFixed?: (fixed: FixedDraft) => void;
  /** Told about every finished run, so the page can carry the evidence forward. */
  onRun?: (run: CompletedRun) => void;
}) {
  const [fixing, setFixing] = useState<
    { status: "idle" | "working" } | { status: "error"; message: string } | { status: "limit"; limit: FreeToolLimit }
  >({ status: "idle" });
  // process.env names the draft reads. Their values are asked for here, used
  // for this run in the remote browser, and kept only in this component.
  const envNames = [...new Set([...code.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]{0,63})/g)].map((match) => match[1]))].slice(0, 10);
  const [env, setEnv] = useState<Record<string, string>>(() => ({ ...(initialEnv ?? {}) }));
  const suppliedEnv = Object.fromEntries(envNames.filter((name) => env[name]).map((name) => [name, env[name]]));
  const [state, setState] = useState<
    { status: "idle" } | { status: "running" } | { status: "done"; result: RunResult } | { status: "error"; message: string }
  >({ status: "idle" });

  // The page's own loop may have run this code already, in which case its
  // result belongs here. Derived rather than copied into state, so a run
  // arriving after this panel is on screen still shows, and a run started here
  // takes over from it.
  const shown = state.status === "idle" && initialRun ? ({ status: "done", result: initialRun } as const) : state;

  async function run() {
    setState({ status: "running" });
    try {
      const response = await fetch("/api/preview-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          pageUrl,
          ...(draftId ? { draftId } : {}),
          ...(Object.keys(suppliedEnv).length ? { env: suppliedEnv } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setState({ status: "error", message: data.error || "The live run could not be completed." });
        return;
      }
      setState({ status: "done", result: data.result });
      const counts: RunResult["counts"] = data.result.counts;
      onRun?.({
        code,
        receipt: typeof data.receipt === "string" ? data.receipt : null,
        verdict: counts.failed > 0 ? "failed" : counts.skipped > 0 || counts.notReached > 0 || data.result.timedOut ? "partial" : "passed",
        passed: counts.passed,
      });
    } catch {
      setState({ status: "error", message: "The live run could not reach the service." });
    }
  }

  const firstFailure =
    shown.status === "done"
      ? shown.result.tests
          .flatMap((test) => test.steps.map((step) => ({ test, step })))
          .find(({ step }) => step.status === "failed")
      : undefined;
  const failedOperation = firstFailure?.step.operations.find((operation) => operation.status === "failed");
  // Lines before the failure that the preview could not run: their effect (a
  // login, items added in a helper) is missing from the page it failed on.
  const skippedEarlier = firstFailure
    ? firstFailure.test.steps
        .flatMap((step) => step.operations)
        .slice(0, Math.max(0, firstFailure.test.steps.flatMap((step) => step.operations).indexOf(failedOperation!)))
        .filter((operation) => operation.status === "skipped")
        .map((operation) => operation.source.slice(0, 300))
        .slice(0, 20)
    : [];

  async function fix() {
    if (!firstFailure || !failedOperation || !firstFailure.test.failureSnapshot) return;
    setFixing({ status: "working" });
    try {
      const response = await fetch("/api/repair-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code,
          pageUrl,
          failure: { step: firstFailure.step.name, line: failedOperation.source, reason: failedOperation.detail ?? "" },
          pageTreeAtFailure: firstFailure.test.failureSnapshot,
          ...(skippedEarlier.length ? { skippedEarlier } : {}),
          ...(pageTreeAtStart ? { pageTreeAtStart } : {}),
          ...(draftId ? { draftId } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        const limit = readFreeToolLimit(response.status, data);
        setFixing(limit ? { status: "limit", limit } : { status: "error", message: data.error || "The draft could not be fixed automatically." });
        return;
      }
      setFixing({ status: "idle" });
      onFixed?.(data.result);
    } catch {
      setFixing({ status: "error", message: "Could not reach the service." });
    }
  }

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
          disabled={shown.status === "running"}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 text-sm font-bold text-slate-950 hover:bg-cyan-300 disabled:opacity-60"
        >
          {shown.status === "running" ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
              Running in a real browser&hellip;
            </>
          ) : shown.status === "done" ? (
            "Run again"
          ) : (
            "Run on the live page"
          )}
        </button>
      </div>

      {envNames.length ? (
        <details open={envNames.some((name) => !env[name])} className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-200">
            Values for this run &middot; {envNames.filter((name) => env[name]).length} of {envNames.length} set
          </summary>
          <p className="mt-2 text-xs leading-5 text-slate-400">
            The test reads these from the environment. Enter test-account values to run those steps; they are used for
            this run only and never saved. Steps without a value are listed as not run.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {envNames.map((name) => (
              <label key={name} className="text-xs font-semibold text-slate-300">
                <span className="font-mono">{name}</span>
                <input
                  type={/pass|secret|token|key/i.test(name) ? "password" : "text"}
                  autoComplete="off"
                  value={env[name] ?? ""}
                  onChange={(event) => {
                    const next = { ...env, [name]: event.target.value };
                    setEnv(next);
                    onEnvChange?.(next);
                  }}
                  maxLength={500}
                  className="mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-3 py-2 font-mono text-xs text-white outline-none focus:border-cyan-400"
                />
              </label>
            ))}
          </div>
        </details>
      ) : null}

      {shown.status === "error" ? (
        <p role="alert" className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-red-200">{shown.message}</p>
      ) : null}

      {shown.status === "done" ? (
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
              {onFixed && firstFailure.test.failureSnapshot && failedOperation ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={fix}
                    disabled={fixing.status === "working"}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-white px-3.5 text-xs font-bold text-slate-950 hover:bg-cyan-100 disabled:opacity-60"
                  >
                    {fixing.status === "working" ? (
                      <>
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
                        Fixing from what the page really had&hellip;
                      </>
                    ) : (
                      "Fix this step with AI"
                    )}
                  </button>
                  <span className="text-xs text-red-100/80">
                    Uses the page as it was when the step failed, then you run it again to check.
                  </span>
                </div>
              ) : null}
              {fixing.status === "error" ? <p className="mt-2 text-xs text-red-200">{fixing.message}</p> : null}
              {fixing.status === "limit" ? <LimitReached limit={fixing.limit} returnTo="/generator" /> : null}
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
              {shown.result.counts.skipped > 0
                ? `Every step that could run passed on the live page (${shown.result.counts.passed} checks).`
                : `Passed on the live page: ${shown.result.counts.passed} checks in ${Math.round(shown.result.durationMs / 1000)}s.`}
            </div>
          )}

          <p className="text-xs text-slate-400">
            {shown.result.counts.passed} passed &middot; {shown.result.counts.failed} failed
            {shown.result.counts.skipped ? ` · ${shown.result.counts.skipped} not run in the preview` : ""}
            {shown.result.counts.notReached ? ` · ${shown.result.counts.notReached} not reached` : ""}
            {" "}&middot; {Math.round(shown.result.durationMs / 1000)}s
            {shown.result.timedOut ? " · stopped at the time limit" : ""}
          </p>

          {shown.result.tests.map((test) => (
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
