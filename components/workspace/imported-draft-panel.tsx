import Link from "next/link";

import { CodeBlock } from "@/components/workspace/code-block";
import { LocalTime } from "@/components/workspace/local-time";
import { PendingButton } from "@/components/workspace/pending-button";
import { importedDraftSourceLabel, type ImportedRunEvidence } from "@/lib/services/imported-drafts";

type ImportedDraft = {
  source: string;
  code: string;
  pageUrl: string | null;
  evidence: ImportedRunEvidence | null;
  usedInAutomationVersionId: string | null;
  usedAt: Date | null;
};

/**
 * The badge beside imported code, saying what its live run actually showed.
 *
 * Exported so the partial case can be tested: it is the one verdict whose
 * number reads like good news on its own.
 */
export function evidenceLabel(evidence: ImportedRunEvidence | null, source: string) {
  if (!evidence && source === "editor") return { text: "Not run by PlaywrightGen yet", tone: "bg-white text-slate-600 ring-1 ring-slate-200" };
  if (!evidence) return { text: "Not run on the live page before import", tone: "bg-white text-slate-600 ring-1 ring-slate-200" };
  if (evidence.verdict === "passed") return { text: `Passed on the live page · ${evidence.passed} checks`, tone: "bg-emerald-700 text-white" };
  if (evidence.verdict === "partial") {
    // The count of what did not run belongs in the label, not only in the
    // word "partly". A reviewer deciding whether to approve read "Partly run
    // on the live page, 7 checks passed" and had no way to tell that anything
    // had been left out, let alone how much -- the number beside it was the
    // good news on its own.
    const notRun = evidence.skipped + evidence.notReached;
    return {
      text: `Partly run on the live page · ${evidence.passed} passed, ${notRun} not run`,
      tone: "bg-amber-100 text-amber-900",
    };
  }
  return { text: "Its last live run failed", tone: "bg-red-100 text-red-800" };
}

/**
 * Code that came with this Test Case, from Quick Generate or an editor's AI assistant.
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
  const label = evidenceLabel(draft.evidence, draft.source);
  return (
    <div className={`mt-5 rounded-xl border p-4 ${draft.evidence?.verdict === "passed" ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white"}`}>
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <p className="text-sm font-semibold text-slate-950">Code from {importedDraftSourceLabel(draft.source)}</p>
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
      {/*
        Said where the decision is made. This panel sits on the Test Case
        page, which is where a lead presses Approve, and a partial run is the
        one verdict whose meaning is not obvious from its number: nothing
        failed, so it reads like a pass. What it actually means is that some
        steps were never exercised, and the step a test was written for is
        often exactly the one the preview cannot replay -- a reload, in the
        run that prompted this. The approval is still the reviewer's to give;
        this makes sure they know what they are giving it on.
      */}
      {draft.evidence?.verdict === "partial" ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          Nothing failed, but {draft.evidence.skipped + draft.evidence.notReached}{" "}
          {draft.evidence.skipped + draft.evidence.notReached === 1 ? "step was" : "steps were"} never run, so{" "}
          {draft.evidence.skipped + draft.evidence.notReached === 1 ? "it is" : "they are"} unproven. Check the code below
          against the steps above before approving.
        </p>
      ) : null}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-semibold text-cyan-800">Show the code</summary>
        {/*
          The same highlighter the automation page uses. This panel is where a
          reviewer first reads code an agent or a free tool wrote, and it was
          showing it as one flat colour -- the exact complaint that put a
          highlighter on the automation page in the first place.
        */}
        <div className="mt-2">
          <CodeBlock code={draft.code} maxHeight="20rem" />
        </div>
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
