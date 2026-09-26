import type { Metadata } from "next";
import Link from "next/link";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { LocalTime } from "@/components/workspace/local-time";
import { PendingButton } from "@/components/workspace/pending-button";
import {
  EvidenceSignatureError,
  readLinkSignatures,
  signEvidence,
} from "@/lib/services/evidence-signature";
import { ageWord } from "@/lib/services/evidence-document";
import { buildReleaseEvidenceReport } from "@/lib/services/release-evidence";
import { resolveProofLink } from "@/lib/services/release-proof";

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

export default async function ProofPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ signed?: string }>;
}) {
  const { token } = await params;
  const { signed } = await searchParams;
  const claim = await resolveProofLink(decodeURIComponent(token));
  if (!claim) return <Expired />;

  // A frozen link answers from what was kept; a live one reads the project.
  const report =
    claim.snapshot ??
    (await buildReleaseEvidenceReport({
      organizationId: claim.organizationId,
      projectId: claim.projectId,
    }).catch(() => null));
  if (!report) return <Expired />;
  const frozen = Boolean(claim.snapshot);
  const signatures = await readLinkSignatures(decodeURIComponent(token)).catch(() => []);

  /**
   * The one thing a reader may write. It goes through the same check as
   * opening the page, so a stopped or expired link signs nothing.
   */
  async function signAction(formData: FormData) {
    "use server";
    const path = `/proof/${token}`;
    try {
      await signEvidence(decodeURIComponent(token), {
        signedName: String(formData.get("signedName") ?? ""),
        signedRole: String(formData.get("signedRole") ?? "") || undefined,
        note: String(formData.get("note") ?? "") || undefined,
      });
    } catch (error) {
      if (error instanceof EvidenceSignatureError) redirect(`${path}?signed=${error.code}`);
      throw error;
    }
    revalidatePath(path);
    redirect(`${path}?signed=yes`);
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Test evidence</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{report.project.name}</h1>
        <p className="mt-2 text-sm text-slate-600">
          {report.organization.name} &middot; {frozen ? "taken" : "as of"} <LocalTime value={report.generatedAt} />
        </p>
        {frozen ? (
          <p className="mt-3 w-fit rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
            A snapshot. It shows what was true when it was shared, and does not change.
          </p>
        ) : null}
        <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">
          Each requirement below is shown with the approved tests that verify it and how those tests last ran. Every
          result was recorded when the test ran, against the approved version it ran. This page is a copy of that
          record: it cannot be edited here, and it shows no test code.
          {frozen ? "" : " It is read fresh each time this link is opened, so it follows the project."}
        </p>
        <a
          href={`/proof/${encodeURIComponent(token)}/download`}
          className="mt-5 inline-flex rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
        >
          Download this evidence
        </a>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          One page you can keep, print or attach to a record. This link expires; the file does not.
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

      {report.totals.stale ? (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          {report.totals.stale} of the verified requirement{report.totals.stale === 1 ? " was" : "s were"} last checked
          more than a month ago. A verdict is only as current as the run behind it.
        </p>
      ) : null}

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
                    {requirement.approvedBy ? ` · approved by ${requirement.approvedBy}` : ""}
                    {" · "}
                    <span className={requirement.freshness === "STALE" ? "font-semibold text-amber-700" : undefined}>
                      {ageWord(requirement.ageDays)}
                    </span>
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
                        Version {testCase.versionNumber}
                        {testCase.authoredByAgent ? ` · proposed by ${testCase.authoredByAgent}` : ""} &middot;{" "}
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

      <section className="mt-10 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" aria-labelledby="sign-off">
        <h2 id="sign-off" className="text-lg font-semibold text-slate-950">Accept this evidence</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          If you are the person who decides whether this is acceptable, you can put that on the record here. Your
          answer is kept with a copy of exactly what is on this page, so a reader a year from now can tell what was
          accepted.
        </p>

        {signatures.length ? (
          <ul className="mt-4 space-y-2">
            {signatures.map((signature) => (
              <li key={signature.id} className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-sm font-semibold text-emerald-950">
                  Accepted by {signature.signedName}
                  {signature.signedRole ? `, ${signature.signedRole}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-emerald-900">
                  <LocalTime value={signature.signedAt} />
                </p>
                {signature.note ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-emerald-900">{signature.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {signed === "yes" ? (
          <p role="status" className="mt-4 text-sm font-semibold text-emerald-800">
            Recorded. The team can see it with the evidence.
          </p>
        ) : signed === "invalid_input" ? (
          <p role="alert" className="mt-4 text-sm font-semibold text-red-700">Please give the name to record.</p>
        ) : signed === "too_many" ? (
          <p role="alert" className="mt-4 text-sm font-semibold text-red-700">
            This link already carries as many acceptances as it can hold. Ask the team for a new one.
          </p>
        ) : signed === "link_invalid" ? (
          <p role="alert" className="mt-4 text-sm font-semibold text-red-700">
            This link is no longer valid, so nothing was recorded.
          </p>
        ) : null}

        <form action={signAction} className="mt-4 grid gap-3 sm:max-w-xl">
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Your name
            <input
              name="signedName"
              required
              maxLength={120}
              autoComplete="name"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-600 focus-visible:ring-2 focus-visible:ring-cyan-500/60"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Your role <span className="font-normal text-slate-400">(optional)</span>
            <input
              name="signedRole"
              maxLength={120}
              placeholder="Product owner"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-600 focus-visible:ring-2 focus-visible:ring-cyan-500/60"
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            Anything to record with it <span className="font-normal text-slate-400">(optional)</span>
            <textarea
              name="note"
              rows={3}
              maxLength={2_000}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-600 focus-visible:ring-2 focus-visible:ring-cyan-500/60"
            />
          </label>
          <PendingButton
            pendingLabel="Recording…"
            className="w-fit rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Accept this evidence
          </PendingButton>
        </form>
        <p className="mt-3 text-xs leading-5 text-slate-500">
          PlaywrightGen records the name you type. It does not check who you are, and says so wherever this is shown:
          the record is that a named person accepted this evidence, not that their identity was verified.
        </p>
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
