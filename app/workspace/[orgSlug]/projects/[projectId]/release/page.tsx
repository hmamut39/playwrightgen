import Link from "next/link";

import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { getReleaseReadiness } from "@/lib/services/release-readiness";

const freshnessLabel = {
  FRESH: "Fresh",
  AGING: "Aging",
  STALE: "Stale",
  MISSING: "None recorded",
} as const;

function Metric({
  label,
  value,
  of,
  caption,
}: {
  label: string;
  value: number;
  of?: number;
  caption: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
        {value}
        {of === undefined ? null : <span className="text-slate-400"> of {of}</span>}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{caption}</p>
    </div>
  );
}

export default async function ReleaseReadinessPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const readiness = await getReleaseReadiness({ orgSlug, projectId });

  const blockers = readiness.findings.filter((f) => f.severity === "BLOCKER");
  const cautions = readiness.findings.filter((f) => f.severity === "CAUTION");

  return (
    <div className="mx-auto max-w-5xl">
      <div className="print:hidden">
        <ProjectNavigation organizationSlug={orgSlug} projectId={projectId} />
      </div>

      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
          {readiness.project.name}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
          Release readiness
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Derived from approved requirements, versioned automation, and immutable run
          evidence. Every claim below links to the record it came from. No score is
          produced, because a single number would hide the detail a reviewer needs.
        </p>
        {/* The freshness clock counts requirement and test-case edits as well
            as runs, so it can read "fresh" on a project that has never executed
            anything. Stating the execution count alongside it keeps the header
            from implying evidence that does not exist. */}
        <p className="mt-3 text-xs text-slate-400">
          Measured {readiness.measuredAt.toLocaleString()} ·{" "}
          {readiness.evidence.hasExecution
            ? `${readiness.evidence.attemptCount} recorded ${readiness.evidence.attemptCount === 1 ? "attempt" : "attempts"}, last activity ${freshnessLabel[readiness.evidence.freshness].toLowerCase()}${readiness.evidence.ageDays !== null ? ` at ${readiness.evidence.ageDays} days old` : ""}`
            : "No execution has ever been recorded"}
        </p>
      </header>

      <section
        className={`mt-8 rounded-3xl border p-6 sm:p-8 ${
          readiness.releasable
            ? "border-emerald-200 bg-emerald-50/50"
            : "border-red-200 bg-red-50/50"
        }`}
      >
        <p
          className={`text-xs font-semibold uppercase tracking-[0.16em] ${
            readiness.releasable ? "text-emerald-700" : "text-red-700"
          }`}
        >
          {readiness.releasable ? "No blockers found" : "Release is blocked"}
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
          {readiness.releasable
            ? cautions.length === 0
              ? "Nothing is blocking this release."
              : `Nothing is blocking this release, with ${cautions.length} caution${cautions.length === 1 ? "" : "s"} to review.`
            : `${blockers.length} condition${blockers.length === 1 ? "" : "s"} must be resolved first.`}
        </h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          {readiness.releasable
            ? "This states that no blocking condition was found in the recorded evidence. It is not a guarantee about untested behaviour."
            : "Each condition below was derived from a stored record and can be opened and checked."}
        </p>
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Requirement coverage"
          value={readiness.counts.requirementsWithApprovedTests}
          of={readiness.counts.approvedRequirements}
          caption="approved requirements linked to approved test cases"
        />
        <Metric
          label="Current automation"
          value={readiness.counts.testCasesWithCurrentAutomation}
          of={readiness.counts.approvedTestCases}
          caption="approved test cases automated at their current version"
        />
        <Metric
          label="Regressions"
          value={readiness.counts.regressions}
          caption="failures attributable to the application, not the test"
        />
        <Metric
          label="Open findings"
          value={readiness.counts.openFindings}
          caption="failure findings awaiting confirmation or dismissal"
        />
      </div>

      {readiness.findings.length === 0 ? (
        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 text-center">
          <h3 className="text-lg font-semibold text-slate-900">No conditions recorded</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Approve requirements and test cases, then record run evidence, before treating
            an empty result as confidence.
          </p>
        </section>
      ) : (
        <section className="mt-8 space-y-8">
          {[
            ["Blockers", blockers, "border-red-200", "bg-red-50 text-red-700"] as const,
            ["Cautions", cautions, "border-amber-200", "bg-amber-50 text-amber-800"] as const,
          ].map(([heading, list, border, badge]) =>
            list.length === 0 ? null : (
              <div key={heading}>
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {heading}
                </h3>
                <div className="mt-3 space-y-3">
                  {list.map((finding) => (
                    <div
                      key={finding.code}
                      className={`rounded-2xl border bg-white p-5 ${border}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h4 className="font-semibold text-slate-950">{finding.title}</h4>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${badge}`}
                        >
                          {finding.count}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{finding.detail}</p>
                      {finding.href ? (
                        <Link
                          href={finding.href}
                          className="mt-3 inline-flex text-sm font-semibold text-cyan-700 hover:text-cyan-800 print:hidden"
                        >
                          Inspect the records →
                        </Link>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ),
          )}
        </section>
      )}

      <p className="mt-10 text-xs leading-5 text-slate-400">
        Counts are direct database relationships, not an AI judgement. Missing evidence is
        reported as missing and never counted as a pass.
      </p>
    </div>
  );
}
