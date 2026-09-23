import Link from "next/link";
import { notFound } from "next/navigation";

import { LocalTime } from "@/components/workspace/local-time";
import { changeSummary, compareEvidence, VERDICT_WORD } from "@/lib/services/evidence-change";
import { getReleaseEvidenceReport } from "@/lib/services/release-evidence";
import { readProofLinkSnapshot } from "@/lib/services/release-proof";

/**
 * The project, measured against a snapshot it was compared to before.
 *
 * A frozen proof link says what was true when it was shared. This says what
 * has happened since, which is the question anyone preparing the next release
 * actually asks. It states differences between two stored reports and nothing
 * more: a verdict that moved is reported as a verdict that moved, never as a
 * regression, because the record cannot tell a broken product from a changed
 * test.
 */

const verdictStyle = {
  VERIFIED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  FAILING: "bg-red-50 text-red-800 ring-red-200",
  UNVERIFIED: "bg-slate-100 text-slate-700 ring-slate-200",
} as const;

function Verdict({ verdict }: { verdict: keyof typeof verdictStyle }) {
  return (
    <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${verdictStyle[verdict]}`}>
      {VERDICT_WORD[verdict]}
    </span>
  );
}

export default async function SnapshotChangesPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string; proofLinkId: string }>;
}) {
  const { orgSlug, projectId, proofLinkId } = await params;
  const kept = await readProofLinkSnapshot({ orgSlug, projectId, proofLinkId });
  if (!kept) notFound();

  const now = await getReleaseEvidenceReport({ orgSlug, projectId });
  const change = compareEvidence(kept.snapshot, now);
  const base = `/workspace/${orgSlug}/projects/${projectId}`;

  return (
    <div className="mx-auto max-w-4xl pb-16">
      <Link href={`${base}/release`} className="text-sm font-semibold text-cyan-700 hover:text-cyan-800">
        ← Release readiness
      </Link>

      <header className="mt-4 border-b border-slate-200 pb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
          {kept.snapshot.organization.name} · {kept.snapshot.project.name}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">What changed since this snapshot</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          The snapshot was taken <LocalTime value={kept.takenAt} />
          {kept.sharedBy ? ` by ${kept.sharedBy}` : ""}. Everything below is the difference between it and the project
          now, read <LocalTime value={now.generatedAt} />.
        </p>
        <p
          className={`mt-4 rounded-2xl border p-4 text-sm font-semibold ${
            change.moved.some((move) => move.worse)
              ? "border-red-200 bg-red-50 text-red-900"
              : change.same
                ? "border-slate-200 bg-slate-50 text-slate-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
          }`}
        >
          {changeSummary(change)}
        </p>
      </header>

      {change.moved.length ? (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Verdicts that moved</h2>
          <ul className="mt-3 space-y-2">
            {change.moved.map((move) => (
              <li
                key={move.id}
                className={`rounded-2xl border p-4 ${move.worse ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}
              >
                <p className="font-medium text-slate-950">{move.title}</p>
                <p className="mt-1 text-xs text-slate-600">
                  Was {VERDICT_WORD[move.from]}, now {VERDICT_WORD[move.to]}.
                  {move.worse ? " This is the kind of change a release decision stops for." : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {change.added.length ? (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Added since the snapshot
          </h2>
          <ul className="mt-3 space-y-2">
            {change.added.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="font-medium text-slate-950">{item.title}</p>
                <Verdict verdict={item.verdict} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {change.removed.length ? (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            In the snapshot, not in the project now
          </h2>
          <ul className="mt-3 space-y-2">
            {change.removed.map((item) => (
              <li key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="font-medium text-slate-950">{item.title}</p>
                <p className="mt-1 text-xs text-slate-500">
                  It was {VERDICT_WORD[item.verdict]} when the snapshot was taken. The snapshot still shows it; anyone
                  reading that link sees a requirement this project no longer has.
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-8 text-xs leading-5 text-slate-500">
        The snapshot itself never changes, which is what makes this comparison possible. Nothing here is a judgement:
        a verdict that moved from verified to failing may be a product that broke or a test that was changed, and the
        record cannot tell them apart.
      </p>
    </div>
  );
}
