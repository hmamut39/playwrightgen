"use client";

import { useState } from "react";

import { CI_PROVIDERS, CI_TEMPLATES, type CiProvider } from "@/lib/ci/templates";
import { LocalTime } from "@/components/workspace/local-time";

type CopyFieldProps = {
  label: string;
  value: string;
  secret?: boolean;
};

export function CopyField({ label, value, secret = false }: CopyFieldProps) {
  const [revealed, setRevealed] = useState(!secret);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard access can be denied; the value stays selectable by hand.
      setRevealed(true);
    }
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <code
          className="min-w-0 flex-1 truncate rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700"
          title={revealed ? value : undefined}
        >
          {revealed ? value : "•".repeat(Math.min(44, value.length))}
        </code>
        {secret ? (
          <button
            type="button"
            onClick={() => setRevealed((current) => !current)}
            className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
          >
            {revealed ? "Hide" : "Reveal"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-xs font-medium text-cyan-800 transition hover:border-cyan-300 hover:bg-cyan-100"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

export type CiSetupPanelProps = {
  configured: boolean;
  hasActiveConnection: boolean;
  organizationId?: string;
  projectId?: string;
  token?: string;
  tokenVersion?: number;
  orgSlug: string;
  appUrl: string;
  /**
   * The last time their CI reached here. Null means never, which is its own
   * answer: until now an empty Test Runs tab meant either that, or a wrong
   * token, or a suite with no markers, and nothing told them which.
   */
  lastDelivery?: {
    receivedAt: Date | string;
    providerName: string;
    runUrl: string | null;
    ref: string | null;
    commitSha: string | null;
    recorded: number;
    unmatched: number;
    total: number;
    note: string;
  } | null;
  /**
   * A delivery that arrived and was refused, when that happened more
   * recently than the last one recorded. Shown first because it is the
   * thing to fix: the pipeline is running and being turned away.
   */
  lastRejection?: {
    receivedAt: Date | string;
    providerName: string;
    ref: string | null;
    note: string;
  } | null;
  rotateAction?: (formData: FormData) => void | Promise<void>;
};

export function CiSetupPanel({
  configured,
  hasActiveConnection,
  organizationId,
  projectId,
  token,
  tokenVersion,
  orgSlug,
  appUrl,
  lastDelivery,
  lastRejection,
  rotateAction,
}: CiSetupPanelProps) {
  // Which pipeline the instructions below are written for. An IT department
  // rarely runs only one, and instructions for the wrong one are worse than
  // none: they look followable right up to the point they fail.
  const [provider, setProvider] = useState<CiProvider>("github-actions");
  const active = CI_PROVIDERS.find((entry) => entry.id === provider) ?? CI_PROVIDERS[0];

  return (
    <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
        Continuous integration
      </p>
      <h2 className="mt-2 text-xl font-semibold tracking-[-0.02em]">
        Run tests in your own CI
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
        Your tests run on your own runners, against your environment, using your
        own secrets, on GitHub Actions, GitLab CI or Jenkins. PlaywrightGen never executes your code and never
        receives your source — only a bounded summary of results, which becomes
        immutable Test Run evidence pinned to the approved version each test
        covers.
      </p>

      {!configured ? (
        <p className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          Result ingestion is not configured on this deployment.{" "}
          <code className="font-mono text-xs">RUNNER_INGEST_SECRET</code> must be
          set before a project token can be issued.
        </p>
      ) : !hasActiveConnection ? (
        <p className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
          Connect a repository above first. Results are attributed to the person
          who created the active connection, so ingestion stays closed until one
          exists.
        </p>
      ) : (
        <>
          <div className="mt-6 grid gap-4">
            <CopyField label="Repository secret · PLAYWRIGHTGEN_TOKEN" value={token ?? ""} secret />
            <div className="grid gap-4 sm:grid-cols-2">
              <CopyField label="Variable · PLAYWRIGHTGEN_ORG_ID" value={organizationId ?? ""} />
              <CopyField label="Variable · PLAYWRIGHTGEN_PROJECT_ID" value={projectId ?? ""} />
            </div>
            <CopyField label="Variable · PLAYWRIGHTGEN_URL" value={appUrl} />
          </div>

          <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Pipeline">
            {CI_PROVIDERS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setProvider(entry.id)}
                aria-pressed={entry.id === provider}
                className={
                  entry.id === provider
                    ? "rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-800"
                    : "rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                }
              >
                {entry.name}
              </button>
            ))}
          </div>

          <ol className="mt-4 grid gap-3 text-sm leading-6 text-slate-600">
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                1
              </span>
              <span>
                In{" "}
                <strong className="font-medium text-slate-800">{active.where}</strong>
                , {active.secretLabel}
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                2
              </span>
              <div className="min-w-0 grid gap-2">
                <span>
                  Download both files and commit each one at the path shown. These
                  are the same files this deployment is tested against, so what you
                  run is what was verified here.
                </span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {active.files.map((name) => (
                    <a
                      key={name}
                      href={`/ci/${name}`}
                      download
                      className="group grid min-w-0 gap-1 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 transition hover:border-cyan-300 hover:bg-cyan-50/40"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <code className="min-w-0 truncate font-mono text-xs text-slate-700">
                          {CI_TEMPLATES[name].destination}
                        </code>
                        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700">
                          Download
                        </span>
                      </span>
                      <span className="text-xs leading-5 text-slate-500">
                        {CI_TEMPLATES[name].summary}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                3
              </span>
              <span>
                Run the pipeline. Approved automation carries a version marker, so
                each result attaches to the exact Test Case version it exercised.
                Results appear under Test Runs.
              </span>
            </li>
          </ol>

          <div
            className={
              lastDelivery
                ? "mt-6 rounded-2xl border border-slate-200 bg-white px-4 py-3.5"
                : "mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-3.5"
            }
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              Last results delivery
            </p>
            {lastRejection ? (
              <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5">
                <p className="text-xs font-semibold text-red-900">
                  {lastRejection.providerName} was turned away{" "}
                  <LocalTime value={lastRejection.receivedAt} />
                  {lastRejection.ref ? (
                    <>
                      {" "}
                      from <span className="font-medium">{lastRejection.ref}</span>
                    </>
                  ) : null}
                  .
                </p>
                <p className="mt-1 text-xs leading-5 text-red-900">{lastRejection.note}</p>
              </div>
            ) : null}
            {lastDelivery ? (
              <>
                <p className="mt-1.5 text-sm leading-6 text-slate-700">
                  {lastDelivery.providerName} reached this project{" "}
                  <LocalTime value={lastDelivery.receivedAt} />
                  {lastDelivery.ref ? (
                    <>
                      {" "}
                      from <span className="font-medium text-slate-800">{lastDelivery.ref}</span>
                    </>
                  ) : null}
                  {lastDelivery.commitSha ? (
                    <>
                      {" "}
                      at{" "}
                      <code className="font-mono text-xs">
                        {lastDelivery.commitSha.slice(0, 8)}
                      </code>
                    </>
                  ) : null}
                  .
                </p>
                {/* The counts, in words. A pipeline that delivered nothing
                    usable is not broken, and the difference matters. */}
                <p
                  className={
                    lastDelivery.recorded === 0 && lastDelivery.total > 0
                      ? "mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900"
                      : "mt-2 text-xs leading-5 text-slate-500"
                  }
                >
                  {lastDelivery.note}
                </p>
                {/* The note explains why nothing was recorded; this says
                    where to go about it, which a CI log cannot. */}
                {lastDelivery.recorded === 0 && lastDelivery.total > 0 ? (
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    Every Test Case page shows its own marker, for tests that
                    already live in your repository.
                  </p>
                ) : null}
                {lastDelivery.runUrl ? (
                  <a
                    href={lastDelivery.runUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-xs font-medium text-cyan-700 underline underline-offset-2"
                  >
                    Open the pipeline run
                  </a>
                ) : null}
              </>
            ) : (
              <p className="mt-1.5 text-sm leading-6 text-slate-600">
                No results have arrived from your CI yet. When a pipeline reaches
                this project it is recorded here, even if none of its results
                could be attached to a test &mdash; so a pipeline that cannot
                reach us never looks the same as one that can.
              </p>
            )}
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs leading-5 text-slate-500">
                Treat this token as a credential: it authorizes writing test
                evidence into this project. Rotating it revokes the current value
                immediately and affects no other project.
                {tokenVersion !== undefined ? (
                  <span className="ml-1 text-slate-400">Version {tokenVersion}.</span>
                ) : null}
              </p>
              {rotateAction ? (
                <form action={rotateAction} className="shrink-0">
                  <input type="hidden" name="orgSlug" value={orgSlug} />
                  <input type="hidden" name="projectId" value={projectId ?? ""} />
                  <button
                    type="submit"
                    className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-50"
                  >
                    Rotate token
                  </button>
                </form>
              ) : null}
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              After rotating, update{" "}
              <code className="font-mono">PLAYWRIGHTGEN_TOKEN</code> in the
              repository. Any workflow still holding the old token will be
              rejected until it is updated, which is what revocation is for.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
