import { LocalTime } from "@/components/workspace/local-time";
import { personName } from "@/lib/format/person-name";
import type { ReviewTrail } from "@/lib/services/approval-policy";

/**
 * Who sent this for review, who decided, and what happens next.
 *
 * A badge that says "Approved" answers the wrong question. The one a lead or an
 * auditor asks is "approved by whom" -- and the one the author asks, after
 * submitting, is "now what?". Both answers already exist in the audit trail;
 * this puts them where the record is read.
 */
export function ReviewTrailPanel({
  trail,
  status,
  canApprove,
}: {
  trail: ReviewTrail;
  status: string;
  canApprove: boolean;
}) {
  if (!trail.submitted && !trail.decision) return null;

  const decision = trail.decision;
  const next =
    status === "IN_REVIEW"
      ? trail.awaitingAnotherApprover
        ? "You submitted this, so a different person has to approve it. Any project lead, admin or owner can."
        : canApprove
          ? "Waiting for a decision. Approve it, or request changes to send it back to draft."
          : "Waiting for a project lead, admin or owner to approve it."
      : null;

  return (
    <section
      aria-label="Review history"
      className="mt-6 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm shadow-sm"
    >
      <dl className="flex flex-wrap gap-x-10 gap-y-3">
        {trail.submitted ? (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Submitted for review
            </dt>
            <dd className="mt-1 text-slate-800">
              {personName(trail.submitted.by)} · <LocalTime value={trail.submitted.at} />
            </dd>
          </div>
        ) : null}
        {decision ? (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {decision.kind === "approved" ? "Approved" : "Changes requested"}
            </dt>
            <dd
              className={`mt-1 ${decision.kind === "approved" ? "text-emerald-800" : "text-amber-900"}`}
            >
              {personName(decision.by)} · <LocalTime value={decision.at} />
            </dd>
          </div>
        ) : null}
      </dl>
      {next ? (
        <p
          className={`mt-3 rounded-lg px-3 py-2 leading-6 ${
            trail.awaitingAnotherApprover
              ? "bg-sky-50 text-sky-900"
              : "bg-amber-50 text-amber-900"
          }`}
        >
          {next}
        </p>
      ) : null}
    </section>
  );
}
