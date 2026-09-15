import Link from "next/link";

import { LocalTime } from "@/components/workspace/local-time";
import { PendingButton } from "@/components/workspace/pending-button";
import type { ImportedRunEvidence } from "@/lib/services/imported-drafts";

type ImportedDraft = {
  code: string;
  pageUrl: string | null;
  evidence: ImportedRunEvidence | null;
  usedInAutomationVersionId: string | null;
  usedAt: Date | null;
};

function evidenceLabel(evidence: ImportedRunEvidence | null) {
  if (!evidence) return { text: "Not run on the live page before import", tone: "bg-white text-slate-600 ring-1 ring-slate-200" };
  if (evidence.verdict === "passed") return { text: `Passed on the live page · ${evidence.passed} checks`, tone: "bg-emerald-600 text-white" };
  if (evidence.verdict === "partial") {
    return { text: `Partly run on the live page · ${evidence.passed} checks passed`, tone: "bg-amber-100 text-amber-900" };
  }
  return { text: "Its last live run failed", tone: "bg-red-100 text-red-800" };
}

/**
 * The code that came in from Quick Generate with this Test Case.
 *
 * Shown with the run evidence recorded at import, and -- once the Test Case is
 * approved -- the choice to make it the first automation version.
 */
export function ImportedDraftPanel({
  draft,
  canUse,
  useAction,
  automationHref,
}: {
  draft: ImportedDraft;
  /** Approved Test Case, the person can create automation, and the code is not used yet. */
  canUse: boolean;
  useAction: () => Promise<void>;
  automationHref: string | null;
}) {
  const label = evidenceLabel(draft.evidence);
  return (
    <div className={`mt-5 rounded-xl border p-4 ${draft.evidence?.verdict === "passed" ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <p className="text-sm font-semibold text-slate-950">Code imported from Quick Generate</p>
        <span className={`w-fit rounded-full px-3 py-1 text-xs font-semibold ${label.tone}`}>{label.text}</span>
      </div>
      {draft.evidence ? (
        <p className="mt-2 text-xs leading-5 text-slate-600">
          Ran on <span className="font-medium">{draft.evidence.pageUrl}</span> on <LocalTime value={new Date(draft.evidence.ranAt)} />{" "}
          &middot; {draft.evidence.tests} test{draft.evidence.tests === 1 ? "" : "s"}
          {draft.evidence.inputs?.length ? <> &middot; signed in with a test account ({draft.evidence.inputs.join(", ")})</> : null}
          {" "}&middot; signed by PlaywrightGen for this exact code.
        </p>
      ) : null}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-cyan-800">Show the code</summary>
        <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">{draft.code}</pre>
      </details>
      {draft.usedAt ? (
        <p className="mt-3 text-sm text-slate-600">
          Already used as an automation version.{" "}
          {automationHref ? <Link href={automationHref} className="font-semibold text-cyan-800 hover:text-cyan-950">Open it →</Link> : null}
        </p>
      ) : canUse ? (
        <form action={useAction} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <PendingButton pendingLabel="Creating…" className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">
            Use this code as the automation
          </PendingButton>
          <span className="text-xs text-slate-500">No AI generation. It becomes a draft version and is reviewed like any other.</span>
        </form>
      ) : (
        <p className="mt-3 text-xs text-slate-500">After this Test Case is approved, this code can become its first automation version.</p>
      )}
    </div>
  );
}
