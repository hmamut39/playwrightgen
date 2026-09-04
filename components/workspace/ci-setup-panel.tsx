"use client";

import { useState } from "react";

type CopyFieldProps = {
  label: string;
  value: string;
  secret?: boolean;
};

function CopyField({ label, value, secret = false }: CopyFieldProps) {
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
    <div className="grid gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
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
  appUrl: string;
};

export function CiSetupPanel({
  configured,
  hasActiveConnection,
  organizationId,
  projectId,
  token,
  appUrl,
}: CiSetupPanelProps) {
  return (
    <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
        Continuous integration
      </p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight">
        Run tests in your own CI
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
        Your tests run on your GitHub Actions runners, against your environment,
        using your secrets. PlaywrightGen never executes your code and never
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

          <ol className="mt-6 grid gap-3 text-sm leading-6 text-slate-600">
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                1
              </span>
              <span>
                In your repository, add the token above as an Actions{" "}
                <strong className="font-medium text-slate-800">secret</strong>, and
                the other three as Actions{" "}
                <strong className="font-medium text-slate-800">variables</strong>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                2
              </span>
              <span>
                Copy{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                  playwrightgen.yml
                </code>{" "}
                and{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                  playwrightgen-report.mjs
                </code>{" "}
                from{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                  templates/github-actions/
                </code>{" "}
                into your repository&rsquo;s{" "}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
                  .github/workflows/
                </code>
                .
              </span>
            </li>
            <li className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                3
              </span>
              <span>
                Push. Approved automation carries a version marker, so each result
                attaches to the exact Test Case version it exercised. Results
                appear under Test Runs.
              </span>
            </li>
          </ol>

          <p className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
            Treat this token as a credential: it authorizes writing test evidence
            into this project. Rotation is currently deployment-wide rather than
            per project, so a leaked token cannot yet be revoked on its own.
          </p>
        </>
      )}
    </section>
  );
}
