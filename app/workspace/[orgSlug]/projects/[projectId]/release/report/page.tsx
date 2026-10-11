import Link from "next/link";

import { PrintButton } from "@/components/workspace/print-button";
import { getReleaseEvidenceReport } from "@/lib/services/release-evidence";
import {
  listReleaseMilestones,
  scopeReleaseToMilestone,
} from "@/lib/services/release-scope";
import { LocalTime } from "@/components/workspace/local-time";
import { ageWord } from "@/lib/services/evidence-document";

/**
 * The evidence pack behind a release decision.
 *
 * Everything else in the workspace answers a question about a single record.
 * This answers the one somebody has to put their name to: for each thing the
 * product was supposed to do, what verifies it, when did that last run, and
 * what happened. Until now that answer lived in one person's memory of several
 * screens, which is exactly what an audit cannot accept.
 *
 * Built to print. A release decision gets attached to a ticket, mailed to a
 * regulator or carried into a meeting, so the page drops its navigation and
 * links when printed and keeps every claim and its date.
 */

const verdictStyle = {
  VERIFIED: "border-emerald-300 bg-emerald-50 text-emerald-800",
  FAILING: "border-red-300 bg-red-50 text-red-800",
  UNVERIFIED: "border-slate-300 bg-slate-100 text-slate-600",
} as const;

const verdictLabel = {
  VERIFIED: "Verified",
  FAILING: "Failing",
  UNVERIFIED: "Unverified",
} as const;

function shortSha(sha: string | null) {
  return sha ? sha.slice(0, 8) : null;
}

export default async function ReleaseEvidenceReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
  searchParams: Promise<{ milestone?: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const { milestone: wanted } = await searchParams;
  const report = await getReleaseEvidenceReport({ orgSlug, projectId });
  const base = `/workspace/${orgSlug}/projects/${projectId}`;

  // The grouping comes from the tracker rather than from a release entity
  // here, so a project with no connected repository simply has none to
  // offer. That is an ordinary answer and must not fail the page.
  const milestones = await listReleaseMilestones({ orgSlug, projectId }).catch(() => []);
  const milestoneNumber = Number(wanted);
  const scope =
    Number.isSafeInteger(milestoneNumber) && milestoneNumber > 0
      ? await scopeReleaseToMilestone({ orgSlug, projectId, milestoneNumber }, report).catch(
          () => null,
        )
      : null;

  // One reading of the project, shown whole or narrowed. The totals follow
  // whichever is on screen, because a count that describes something other
  // than the list under it is the oldest way to mislead with a report.
  const requirements = scope ? scope.requirements : report.requirements;
  const totals = scope ? scope.totals : report.totals;

  return (
    <div className="mx-auto max-w-5xl pb-16">
      <div className="print:hidden">
        <Link
          href={`${base}/release`}
          className="text-sm font-semibold text-cyan-700 hover:text-cyan-800"
        >
          ← Release readiness
        </Link>
      </div>

      <header className="mt-4 border-b border-slate-200 pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
          {report.organization.name} · {report.project.name}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
          Release evidence report
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Every requirement in this project, what verifies it, and the result of
          the last run of each verifying test. Assembled from stored records
          only. No judgement is applied beyond what the records state, and a
          requirement nothing has exercised is reported as unverified rather
          than assumed to be fine.
        </p>
        <p className="mt-3 text-xs text-slate-500">
          Generated <LocalTime value={report.generatedAt} />
        </p>
        {totals.stale ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            {totals.stale} of the verified requirement{totals.stale === 1 ? " was" : "s were"} last
            checked more than a month ago. A verdict is only as current as the run behind it.
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3 print:hidden">
          <PrintButton />
          <a
            href={`${base}/release/download`}
            className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Download the file
          </a>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-500 print:hidden">
          The file is one page that opens anywhere, with no test code in it &mdash; attach it to a ticket or keep it
          with the release record.
        </p>
      </header>

      {milestones.length > 0 ? (
        // A release is read from the tracker rather than kept here, so these
        // are the team's own milestones and cannot drift from them.
        <nav className="mt-6 flex flex-wrap items-center gap-2 print:hidden" aria-label="Release scope">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Showing</span>
          <Link
            href={`${base}/release/report`}
            className={
              scope
                ? "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300"
                : "rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800"
            }
          >
            The whole project
          </Link>
          {milestones.map((entry) => (
            <Link
              key={entry.number}
              href={`${base}/release/report?milestone=${entry.number}`}
              className={
                scope?.milestone.number === entry.number
                  ? "rounded-xl border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800"
                  : "rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:border-slate-300"
              }
            >
              {entry.title}
              <span className="ml-1.5 font-normal text-slate-400">{entry.issueCount}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      {scope ? (
        <p className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-600">
          The counts below describe the {scope.requirements.length} requirement
          {scope.requirements.length === 1 ? "" : "s"} written up for{" "}
          <span className="font-semibold text-slate-900">{scope.milestone.title}</span>, not the
          whole project.
          {scope.withoutRequirement > 0 ? (
            <>
              {" "}
              {scope.withoutRequirement} issue
              {scope.withoutRequirement === 1 ? " in it has" : "s in it have"} no requirement here, so
              nothing on this page says anything about {scope.withoutRequirement === 1 ? "it" : "them"}.
            </>
          ) : null}
        </p>
      ) : null}

      <section className="mt-6 grid gap-3 sm:grid-cols-3">
        {(
          [
            ["Verified", totals.verified, "border-emerald-200 bg-emerald-50 text-emerald-800"],
            ["Failing", totals.failing, "border-red-200 bg-red-50 text-red-800"],
            ["Unverified", totals.unverified, "border-slate-200 bg-slate-50 text-slate-700"],
          ] as const
        ).map(([label, value, style]) => (
          <div key={label} className={`rounded-2xl border p-5 ${style}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.14em]">{label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
          </div>
        ))}
      </section>

      {report.requirements.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm leading-6 text-slate-600">
          This project has no requirements, so there is nothing to report. A
          release cannot be evidenced against intent that was never recorded.
        </p>
      ) : (
        <section className="mt-8 space-y-5">
          {requirements.map((requirement) => (
            <article
              key={requirement.id}
              className="break-inside-avoid rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-slate-950">
                    {requirement.title}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Requirement v{requirement.versionNumber} ·{" "}
                    {requirement.status.replace("_", " ").toLowerCase()}
                    {requirement.externalReference
                      ? ` · ${requirement.externalReference}`
                      : ""}
                    {" · "}
                    <span className={requirement.freshness === "STALE" ? "font-semibold text-amber-700" : undefined}>
                      {ageWord(requirement.ageDays)}
                    </span>
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${verdictStyle[requirement.verdict]}`}
                >
                  {verdictLabel[requirement.verdict]}
                </span>
              </div>

              {/* The verdict without its reason is an assertion. With it, a
                  reader can disagree, which is the whole point of a report
                  somebody signs. */}
              <p className="mt-3 text-sm leading-6 text-slate-600">{requirement.reason}</p>

              {requirement.testCases.length > 0 ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-[0.1em] text-slate-500">
                        <th className="py-2 pr-3 font-semibold">Test Case</th>
                        <th className="py-2 pr-3 font-semibold">State</th>
                        <th className="py-2 pr-3 font-semibold">Last result</th>
                        <th className="py-2 font-semibold">When · revision</th>
                      </tr>
                    </thead>
                    <tbody>
                      {requirement.testCases.map((testCase) => (
                        <tr key={testCase.id} className="border-b border-slate-100 align-top">
                          <td className="py-2.5 pr-3 text-slate-900">
                            {testCase.title}
                            <span className="ml-1.5 text-xs text-slate-400">
                              v{testCase.versionNumber}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 text-slate-600">
                            {testCase.status.replace("_", " ").toLowerCase()}
                          </td>
                          <td className="py-2.5 pr-3">
                            {testCase.latestResult ? (
                              <span
                                className={
                                  testCase.latestResult === "PASSED"
                                    ? "font-semibold text-emerald-700"
                                    : "font-semibold text-red-700"
                                }
                              >
                                {testCase.latestResult.toLowerCase()}
                              </span>
                            ) : (
                              <span className="text-slate-400">never run</span>
                            )}
                          </td>
                          <td className="py-2.5 text-xs text-slate-500">
                            {testCase.latestExecutedAt
                              ? <LocalTime value={testCase.latestExecutedAt} />
                              : "—"}
                            {shortSha(testCase.latestCommitSha)
                              ? ` · ${shortSha(testCase.latestCommitSha)}`
                              : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      )}

      {report.truncated ? (
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This project has more requirements than one report can carry, so the
          list above is not complete. Reported rather than silently trimmed,
          because a partial evidence pack presented as a whole one is worse than
          no report at all.
        </p>
      ) : null}

      <p className="mt-8 text-xs leading-5 text-slate-500">
        Every line above is a direct database relationship, not a judgement.
        &ldquo;Verified&rdquo; means an approved Test Case covering the requirement last
        ran and passed; it is not a claim about behaviour nobody tested. Missing
        evidence is reported as missing and never counted as a pass.
      </p>
    </div>
  );
}
