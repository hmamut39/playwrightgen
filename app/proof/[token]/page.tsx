import type { Metadata } from "next";
import Link from "next/link";

import { LocalTime } from "@/components/workspace/local-time";
import { buildReleaseEvidenceReport } from "@/lib/services/release-evidence";
import { readProofToken } from "@/lib/services/release-proof";

/**
 * What a shared proof link shows: the evidence, and nothing else.
 *
 * Whoever opens this was sent a link, not given an account, so the page is
 * read-only by construction -- there is no action on it, no navigation into the
 * workspace, and no test code. It answers one question, "what was tested and
 * how did it last run", in a form someone outside the team can read.
 */

export const metadata: Metadata = {
  title: "Test evidence",
  // A shared record should not be indexed: the link is the permission.
  robots: { index: false, follow: false },
};

const verdictStyle = {
  VERIFIED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  FAILING: "bg-red-50 text-red-800 ring-red-200",
  UNVERIFIED: "bg-slate-100 text-slate-700 ring-slate-200",
} as const;

const resultWord: Record<string, string> = {
  PASSED: "passed",
  FAILED: "failed",
  BLOCKED: "could not run",
  SKIPPED: "was skipped",
};

function Expired() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">This link is no longer valid</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">
        A proof link expires, and the team can retire one at any time. Ask whoever shared it for a new one.
      </p>
      <Link href="/" className="mt-6 w-fit rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
        What is PlaywrightGen?
      </Link>
    </main>
  );
}

export default async function ProofPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const claim = readProofToken(decodeURIComponent(token));
  if (!claim) return <Expired />;

  const report = await buildReleaseEvidenceReport({
    organizationId: claim.organizationId,
    projectId: claim.projectId,
  }).catch(() => null);
  if (!report) return <Expired />;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Test evidence</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{report.project.name}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {report.organization.name} &middot; as of <LocalTime value={report.generatedAt} />
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
          Each requirement below is shown with the approved tests that verify it and how those tests last ran. Every
          result was recorded when the test ran, against the approved version it ran. This page is a copy of that
          record: it cannot be edited here, and it shows no test code.
        </p>
      </header>

      <section className="mt-8 grid gap-3 sm:grid-cols-3" aria-label="Totals">
        {[
          ["Verified", report.totals.verified, "text-emerald-800"],
          ["Failing", report.totals.failing, "text-red-700"],
          ["Not verified", report.totals.unverified, "text-slate-700"],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
            <p className={`mt-2 text-3xl font-semibold ${tone}`}>{value}</p>
          </div>
        ))}
      </section>

      <section className="mt-8 space-y-4">
        {report.requirements.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
            This project has no approved requirements yet, so there is nothing to verify.
          </p>
        ) : (
          report.requirements.map((requirement) => (
            <article key={requirement.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-950">{requirement.title}</h2>
                  <p className="mt-1 text-xs text-slate-400">
                    Version {requirement.versionNumber}
                    {requirement.externalReference ? ` · ${requirement.externalReference}` : ""}
                  </p>
                </div>
                <span
                  className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${verdictStyle[requirement.verdict]}`}
                >
                  {requirement.verdict === "UNVERIFIED" ? "NOT VERIFIED" : requirement.verdict}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">{requirement.reason}</p>
              {requirement.testCases.length ? (
                <ul className="mt-4 space-y-2">
                  {requirement.testCases.map((testCase) => (
                    <li key={testCase.id} className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
                      <p className="font-medium text-slate-900">{testCase.title}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Version {testCase.versionNumber} &middot;{" "}
                        {testCase.latestResult
                          ? `last run ${resultWord[testCase.latestResult] ?? testCase.latestResult.toLowerCase()}`
                          : "never run"}
                        {testCase.latestExecutedAt ? (
                          <>
                            {" "}
                            <LocalTime value={testCase.latestExecutedAt} />
                          </>
                        ) : null}
                        {testCase.latestCommitSha ? ` · commit ${testCase.latestCommitSha.slice(0, 8)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))
        )}
      </section>

      <footer className="mt-10 border-t border-slate-200 pt-6 text-xs leading-5 text-slate-500">
        Shared from PlaywrightGen, which keeps each approval and each run as a record that cannot be edited after the
        fact. This link expires, and whoever shared it can retire it sooner.{" "}
        <Link href="/" className="font-semibold text-cyan-800 underline">
          playwrightgen.com
        </Link>
      </footer>
    </main>
  );
}
