import type { RunSignal } from "@/lib/services/run-signals";
import { runSignalLabel } from "@/lib/services/run-signals";

/**
 * Colour carries meaning here, so it is chosen by what the reader should do:
 * a regression is actionable against the application, a flaky result is
 * actionable against the test, changed intent is informational, a single pass
 * reads as good but not yet proven, and absent evidence is deliberately muted
 * rather than dressed up as a verdict.
 */
const signalStyle: Record<RunSignal, string> = {
  STABLE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  // Distinct from stable on purpose. A single passing revision is good news and
  // is shown as such, but it must not borrow the confidence of a result that
  // has held across changes.
  PASSING: "bg-sky-50 text-sky-700 ring-sky-200",
  FLAKY: "bg-amber-50 text-amber-800 ring-amber-200",
  REGRESSION: "bg-red-50 text-red-700 ring-red-200",
  INTENT_CHANGED: "bg-violet-50 text-violet-700 ring-violet-200",
  NEW_FAILURE: "bg-slate-100 text-slate-700 ring-slate-200",
  INSUFFICIENT: "bg-slate-50 text-slate-400 ring-slate-200",
};

export function RunSignalBadge({
  signal,
  detail,
}: {
  signal: RunSignal;
  detail?: string;
}) {
  return (
    <span
      title={detail}
      className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${signalStyle[signal]}`}
    >
      {runSignalLabel[signal]}
    </span>
  );
}

/**
 * The badge alone would be an unexplained verdict. This states the evidence the
 * verdict rests on, which is the difference between a claim and a conclusion.
 */
export function RunSignalExplanation({
  signal,
  detail,
}: {
  signal: RunSignal;
  detail: string;
}) {
  // Rendered even when no verdict can be drawn. Hiding the block on insufficient
  // evidence leaves a blank where a verdict belongs, and a reader cannot tell
  // silence meaning "nothing is wrong" from silence meaning "we cannot say".
  return (
    <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">
      <RunSignalBadge signal={signal} />
      <p className="text-sm leading-6 text-slate-600">{detail}</p>
    </div>
  );
}
