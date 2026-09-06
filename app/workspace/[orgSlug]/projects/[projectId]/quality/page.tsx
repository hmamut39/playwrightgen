import Link from "next/link";

import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { SetupChecklist } from "@/components/workspace/setup-checklist";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { getProjectQualityIntelligence } from "@/lib/services/project-quality";
import { getProjectSetup } from "@/lib/services/project-setup";

const freshnessStyle = {
  FRESH: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  AGING: "bg-amber-50 text-amber-800 ring-amber-200",
  STALE: "bg-red-50 text-red-700 ring-red-200",
  MISSING: "bg-slate-100 text-slate-600 ring-slate-200",
} as const;

function formatAge(ageDays: number | null) {
  if (ageDays === null) return "No dated evidence";
  if (ageDays === 0) return "Updated today";
  if (ageDays === 1) return "Updated 1 day ago";
  return `Updated ${ageDays} days ago`;
}

export default async function ProjectQualityPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const [intelligence, setup, context] = await Promise.all([
    getProjectQualityIntelligence({ orgSlug, projectId }),
    getProjectSetup({ orgSlug, projectId }),
    requireWorkspaceContext({ orgSlug, projectId }),
  ]);
  const base = `/workspace/${orgSlug}/projects/${projectId}`;
  const totalActionableGaps =
    intelligence.gaps.requirementsWithoutApprovedTests.length +
    intelligence.gaps.testCasesWithoutCurrentAutomation.length +
    intelligence.gaps.staleAutomation.length +
    intelligence.gaps.unreviewedFailedAttempts.length;
  const insufficientEvidence = intelligence.evidence.missing.some(
    (item) =>
      item === "No approved Requirements" || item === "No approved Test Cases",
  );

  return (
    <div className="mx-auto max-w-6xl">
      <ProjectNavigation organizationSlug={orgSlug} projectId={projectId} />

      <header className="rounded-[2rem] border border-slate-800 bg-slate-950 px-6 py-7 text-white shadow-xl shadow-slate-200/70 sm:px-8 sm:py-9">
        <div className="flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-200">
                Quality Command Center
              </span>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${freshnessStyle[intelligence.evidence.freshness]}`}
              >
                {intelligence.evidence.freshness.toLowerCase()} evidence
              </span>
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
              {intelligence.project.name}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
              Find the next quality gap from approved intent, versioned automation,
              immutable runs, and reviewed failure evidence.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-5 py-4 lg:min-w-56">
            <p className="text-xs font-medium text-slate-400">Evidence freshness</p>
            <p className="mt-1 text-sm font-semibold text-white">
              {formatAge(intelligence.evidence.ageDays)}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Measured {intelligence.measuredAt.toLocaleString()}
            </p>
          </div>
        </div>
      </header>

      <SetupChecklist setup={setup} canAct={context.can("requirement:create")} />

      <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Measured quality signals">
        <SignalCard
          label="Requirement coverage"
          value={`${intelligence.counts.requirementsWithApprovedTests} of ${intelligence.counts.approvedRequirements}`}
          detail="approved Requirements linked to approved Test Cases"
          href={`${base}/requirements`}
        />
        <SignalCard
          label="Current automation"
          value={`${intelligence.counts.testCasesWithCurrentAutomation} of ${intelligence.counts.approvedTestCases}`}
          detail="approved Test Cases with automation for their current version"
          href={`${base}/automation`}
        />
        <SignalCard
          label="Recent failed attempts"
          value={`${intelligence.counts.recentFailedAttempts} of ${intelligence.counts.recentAttempts}`}
          detail="recent attempts failed or blocked in the last 30 days"
          href={`${base}/test-runs`}
        />
        <SignalCard
          label="Open findings"
          value={String(intelligence.counts.openFailureFindings)}
          detail="failure findings awaiting confirmation or dismissal"
          href={`${base}/test-runs`}
        />
      </section>

      <section className="mt-5 overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200 px-6 py-6 sm:flex-row sm:items-center sm:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
              What should I fix next?
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
              {totalActionableGaps} actionable {totalActionableGaps === 1 ? "gap" : "gaps"}
            </h2>
          </div>
          <p className="max-w-md text-sm leading-6 text-slate-500 sm:text-right">
            Counts are direct database relationships—not an AI readiness score.
            Open any item to inspect its source record.
          </p>
        </div>

        {totalActionableGaps === 0 ? (
          <div className="px-6 py-12 text-center sm:px-8">
            <h3 className="text-lg font-semibold text-slate-950">
              {insufficientEvidence
                ? "More approved evidence is required"
                : "No current gaps were found in these records"}
            </h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
              {insufficientEvidence
                ? "Approve Requirements and Test Cases before treating an empty queue as confidence."
                : "This is not a guarantee of release readiness. New requirements, runs, and repository evidence can change the result."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            <GapGroup
              eyebrow="Intent coverage"
              title="Approved Requirements without approved tests"
              count={intelligence.gaps.requirementsWithoutApprovedTests.length}
              tone="cyan"
            >
              {intelligence.gaps.requirementsWithoutApprovedTests.map((item) => (
                <GapLink
                  key={item.id}
                  href={`${base}/requirements/${item.id}`}
                  title={item.title}
                  meta={
                    item.linkedTestCaseCount
                      ? `${item.linkedTestCaseCount} linked draft or unapproved Test Case${item.linkedTestCaseCount === 1 ? "" : "s"}`
                      : "No linked Test Cases"
                  }
                />
              ))}
            </GapGroup>

            <GapGroup
              eyebrow="Automation coverage"
              title="Approved Test Cases without current approved automation"
              count={intelligence.gaps.testCasesWithoutCurrentAutomation.length}
              tone="blue"
            >
              {intelligence.gaps.testCasesWithoutCurrentAutomation.map((item) => (
                <GapLink
                  key={item.id}
                  href={`${base}/test-cases/${item.id}`}
                  title={item.title}
                  meta={`Current Test Case version: v${item.currentVersionNumber}`}
                />
              ))}
            </GapGroup>

            <GapGroup
              eyebrow="Version drift"
              title="Approved automation pinned to superseded intent"
              count={intelligence.gaps.staleAutomation.length}
              tone="amber"
            >
              {intelligence.gaps.staleAutomation.map((item) => (
                <GapLink
                  key={item.id}
                  href={`${base}/automation/${item.id}`}
                  title={item.name}
                  meta={`${item.testCaseTitle}: automation uses v${item.automatedVersionNumber}, current intent is v${item.currentVersionNumber}`}
                />
              ))}
            </GapGroup>

            <GapGroup
              eyebrow="Failure review"
              title="Recent failed attempts without reviewed analysis"
              count={intelligence.gaps.unreviewedFailedAttempts.length}
              tone="red"
            >
              {intelligence.gaps.unreviewedFailedAttempts.map((item) => (
                <GapLink
                  key={item.id}
                  href={`${base}/test-runs/${item.testRunId}`}
                  title={item.runName}
                  meta={`${item.result.toLowerCase()} · ${item.testCaseTitle} · ${item.executedAt.toLocaleString()}`}
                />
              ))}
            </GapGroup>
          </div>
        )}
      </section>

      <section className="mt-5 rounded-2xl border border-slate-200 bg-slate-100/70 px-6 py-5 sm:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-950">Evidence limits</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Missing evidence is shown explicitly and never converted into a positive score.
            </p>
          </div>
          <div className="flex max-w-2xl flex-wrap gap-2">
            {intelligence.evidence.missing.length ? (
              intelligence.evidence.missing.map((item) => (
                <span key={item} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                  {item}
                </span>
              ))
            ) : (
              <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                Core project evidence is present
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function SignalCard({
  label,
  value,
  detail,
  href,
}: {
  label: string;
  value: string;
  detail: string;
  href: string;
}) {
  return (
    <Link href={href} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-md">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
      <p className="mt-4 text-xs font-semibold text-cyan-700 group-hover:text-cyan-600">View source →</p>
    </Link>
  );
}

function GapGroup({
  eyebrow,
  title,
  count,
  tone,
  children,
}: {
  eyebrow: string;
  title: string;
  count: number;
  tone: "cyan" | "blue" | "amber" | "red";
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  const dotStyle = {
    cyan: "bg-cyan-500",
    blue: "bg-blue-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
  }[tone];
  return (
    <div className="grid gap-5 px-6 py-6 sm:px-8 lg:grid-cols-[16rem_1fr]">
      <div>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${dotStyle}`} />
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{eyebrow}</p>
        </div>
        <h3 className="mt-2 text-sm font-semibold leading-5 text-slate-950">{title}</h3>
        <p className="mt-2 text-xs text-slate-400">{count} {count === 1 ? "record" : "records"}</p>
      </div>
      <div className="grid gap-2">{children}</div>
    </div>
  );
}

function GapLink({ href, title, meta }: { href: string; title: string; meta: string }) {
  return (
    <Link href={href} className="group flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 transition hover:border-cyan-300 hover:bg-cyan-50/50">
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">{meta}</span>
      </span>
      <span className="shrink-0 text-sm text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-cyan-700">→</span>
    </Link>
  );
}
