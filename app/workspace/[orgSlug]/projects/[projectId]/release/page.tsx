import Link from "next/link";

import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CopyField } from "@/components/workspace/ci-setup-panel";
import { PendingButton } from "@/components/workspace/pending-button";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { badgeTokenFor } from "@/lib/services/evidence-badge";
import { createProofLink, listProofLinks, revokeProofLink } from "@/lib/services/release-proof";
import { siteUrl } from "@/lib/site";
import { getReleaseReadiness } from "@/lib/services/release-readiness";
import { LocalTime } from "@/components/workspace/local-time";

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
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
  searchParams: Promise<{ proof?: string; until?: string; kind?: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const { proof, until, kind } = await searchParams;
  /**
   * The badge is derived from the link we have just minted, because only the
   * hash of a link is kept afterwards. The markdown shows the image alone and
   * never links to the evidence: a README is public, and a link in it would
   * hand the evidence to everyone who reads the repository.
   */
  const proofToken = proof?.split("/proof/")[1];
  const badgeToken = proofToken ? badgeTokenFor(proofToken) : null;
  const badgeMarkdown = badgeToken
    ? `![requirements](${siteUrl()}/badge/${badgeToken}.svg)`
    : null;
  const [readiness, context, proofLinks] = await Promise.all([
    getReleaseReadiness({ orgSlug, projectId }),
    requireWorkspaceContext({ orgSlug, projectId }),
    listProofLinks({ orgSlug, projectId }).catch(() => []),
  ]);

  /**
   * There is nothing to share until a requirement has been approved. A link to
   * a page reading "this project has no approved requirements yet" is worse
   * than no link: it is sent to a manager or an auditor, and it says the team
   * has nothing rather than that the team has not started.
   */
  const hasEvidenceToShare = readiness.counts.approvedRequirements > 0;

  /**
   * Hands someone outside the team a read-only copy of this evidence. The link
   * carries no session and expires; the page it opens shows no test code.
   */
  async function revokeProofAction(formData: FormData) {
    "use server";
    await revokeProofLink({ orgSlug, projectId, proofLinkId: String(formData.get("proofLinkId") ?? "") });
    revalidatePath(`/workspace/${orgSlug}/projects/${projectId}/release`);
  }

  async function proofLinkAction(formData: FormData) {
    "use server";
    const link = await createProofLink({ orgSlug, projectId, freeze: formData.get("freeze") === "yes" });
    redirect(
      `/workspace/${orgSlug}/projects/${projectId}/release?proof=${encodeURIComponent(link.url)}&until=${link.expiresAt.toISOString()}&kind=${link.frozen ? "snapshot" : "live"}`,
    );
  }

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
        {proof ? (
          <div role="status" className="mt-5 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 print:hidden">
            <p className="text-sm font-semibold text-emerald-950">Anyone with this link can read this evidence.</p>
            <CopyField label="Proof link" value={proof} />
            <p className="mt-2 text-xs text-emerald-900">
              It expires {until ? <LocalTime value={new Date(until)} /> : "in 30 days"}.{" "}
              {kind === "snapshot"
                ? "It holds today's evidence and will not change."
                : "It follows the project: whoever opens it sees the evidence as it stands then."}{" "}
              No test code, and no way into this workspace.
            </p>
            <p className="mt-2 text-xs font-semibold text-emerald-900">
              Copy it now. Only a hash of it is kept, so this is the one time it can be shown &mdash; that is also why
              a link that goes astray can be stopped but never rebuilt.
            </p>
            {badgeMarkdown ? (
              <>
                <CopyField label="Badge for a README" value={badgeMarkdown} />
                <p className="mt-2 text-xs text-emerald-900">
                  The badge shows the counts only &mdash; how many requirements are verified &mdash; and opens no
                  evidence, so it is safe in a public README. Stopping the link stops the badge too.
                </p>
              </>
            ) : null}
          </div>
        ) : null}
        {proofLinks.length ? (
          <section aria-label="Shared evidence links" className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 print:hidden">
            <p className="text-sm font-semibold text-slate-900">
              {proofLinks.length} shared link{proofLinks.length === 1 ? "" : "s"} can read this evidence
            </p>
            <ul className="mt-3 space-y-2">
              {proofLinks.map((link) => (
                <li key={link.id} className="flex flex-col justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:flex-row sm:items-center">
                  <span>
                    {link.snapshot ? "Snapshot" : "Live"} &middot; shared by {link.createdBy.displayName || "a lead"}{" "}
                    <LocalTime value={link.createdAt} style="date" /> &middot; expires{" "}
                    <LocalTime value={link.expiresAt} style="date" /> &middot;{" "}
                    {link.lastViewedAt ? <>last opened <LocalTime value={link.lastViewedAt} /></> : "never opened"}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    {link.snapshot ? (
                      <Link
                        href={`/workspace/${orgSlug}/projects/${projectId}/release/changes/${link.id}`}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-800 hover:bg-slate-50"
                      >
                        What changed since
                      </Link>
                    ) : null}
                  {context.can("project:update") ? (
                    <form action={revokeProofAction} className="shrink-0">
                      <input type="hidden" name="proofLinkId" value={link.id} />
                      <PendingButton pendingLabel="Stopping…" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800">
                        Stop this link
                      </PendingButton>
                    </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="mt-5 print:hidden">
          <Link
            href={`/workspace/${orgSlug}/projects/${projectId}/release/report`}
            className="inline-flex rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
          >
            Open the evidence report →
          </Link>
          {context.can("project:update") && !hasEvidenceToShare ? (
            <p className="mt-3 max-w-xl rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600">
              There is nothing to share yet. Evidence becomes shareable once a requirement is approved and a test has
              verified it &mdash;{" "}
              <Link href={`/workspace/${orgSlug}/projects/${projectId}/cover`} className="font-semibold text-cyan-800 underline">
                cover a page
              </Link>{" "}
              is the quickest way there.
            </p>
          ) : null}
          {context.can("project:update") && hasEvidenceToShare ? (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <form action={proofLinkAction}>
                <input type="hidden" name="freeze" value="no" />
                <PendingButton
                  pendingLabel="Making a link…"
                  className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Share this evidence outside the team
                </PendingButton>
              </form>
              <form action={proofLinkAction}>
                <input type="hidden" name="freeze" value="yes" />
                <PendingButton
                  pendingLabel="Taking a snapshot…"
                  className="inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                >
                  Share a snapshot of today
                </PendingButton>
              </form>
            </div>
          ) : null}
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Every requirement, what verifies it, and how each verifying test last
            ran. Built to print or attach to a release ticket.
          </p>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Measured <LocalTime value={readiness.measuredAt} /> ·{" "}
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
