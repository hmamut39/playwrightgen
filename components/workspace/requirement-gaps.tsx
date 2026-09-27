"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

/**
 * What a requirement still needs, and where the reading belongs.
 *
 * The result is rendered here and nowhere else: it is not saved, not counted,
 * and never reaches a verdict or the evidence anybody is shown. That is the
 * whole point of the panel. A mapping between criteria and tests that no
 * person has checked is a good prompt for the person reading it and a bad
 * thing to put in a record, and the difference between those two is whether
 * it was written down as fact.
 */

export type GapsState = {
  status: "idle" | "read" | "error";
  criteria: Array<{ criterion: string; covered: boolean; coveredBy: string[]; reason: string }>;
  notInTheRequirement: string[];
  message: string;
};

export const initialGapsState: GapsState = {
  status: "idle",
  criteria: [],
  notInTheRequirement: [],
  message: "",
};

function Button() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-amber-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-900 disabled:opacity-70"
    >
      {pending ? "Reading…" : "Read the gaps"}
    </button>
  );
}

export function RequirementGaps({
  action,
}: {
  action: (state: GapsState, formData: FormData) => Promise<GapsState>;
}) {
  const [state, formAction] = useActionState(action, initialGapsState);
  const uncovered = state.criteria.filter((entry) => !entry.covered).length;

  return (
    <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50/50 p-6 shadow-sm sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">A reading, not a record</p>
      <h2 className="mt-2 text-lg font-semibold">What this requirement still needs</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-700">
        Reads the acceptance criteria against the approved tests linked to this requirement: which criteria nothing
        appears to check, and which behaviour the tests exercise that this requirement never states &mdash; usually a
        sign the story left something out. Nothing here is stored, counted, or allowed to change a verdict.
      </p>

      <form action={formAction} className="mt-4 flex flex-wrap items-center gap-3">
        <Button />
        <span className="text-xs text-slate-600">Uses one of the workspace&rsquo;s daily AI requests.</span>
      </form>

      {state.status === "error" ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-amber-900">
          {state.message}
        </p>
      ) : null}

      {state.status === "read" ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold text-slate-900">
            {uncovered === 0
              ? `Every one of the ${state.criteria.length} criteria appears to be checked by an approved test.`
              : `${uncovered} of ${state.criteria.length} criteria have nothing that appears to check them.`}
          </p>
          <ul className="space-y-2">
            {state.criteria.map((entry) => (
              <li
                key={entry.criterion}
                className={`rounded-xl border bg-white px-4 py-3 text-sm ${
                  entry.covered ? "border-slate-200" : "border-amber-300"
                }`}
              >
                <p className="font-medium text-slate-950">{entry.criterion}</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  <span className={entry.covered ? "font-semibold text-emerald-800" : "font-semibold text-amber-800"}>
                    {entry.covered ? "appears covered" : "nothing appears to check this"}
                  </span>
                  {entry.coveredBy.length ? ` · ${entry.coveredBy.join(", ")}` : ""} · {entry.reason}
                </p>
              </li>
            ))}
          </ul>

          {state.notInTheRequirement.length ? (
            <div className="rounded-xl border border-amber-300 bg-white px-4 py-3">
              <p className="text-sm font-semibold text-slate-950">
                The tests check things this requirement never states
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Usually a sign the story left something out. Worth adding to the requirement, or removing from the
                tests.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                {state.notInTheRequirement.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
