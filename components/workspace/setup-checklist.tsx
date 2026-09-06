import Link from "next/link";

import type { ProjectSetup } from "@/lib/services/project-setup";

/**
 * The chain a project completes before its numbers mean anything.
 *
 * A new project reports zero everywhere. That is accurate and useless: it says
 * what is missing without saying what to do, and someone seeing it for the first
 * time has no way to learn that approved intent comes first, that a link is what
 * turns a test into coverage, or that evidence only exists once something ran.
 *
 * Shown only while the chain is incomplete. Once every step is done it would be
 * clutter on a page whose job is to surface gaps.
 */
export function SetupChecklist({
  setup,
  canAct,
}: {
  setup: ProjectSetup;
  canAct: boolean;
}) {
  if (setup.complete) return null;

  const total = setup.steps.length;
  // The first unfinished step is the only one worth acting on, since each
  // depends on the one before it.
  const nextIndex = setup.steps.findIndex((step) => !step.done);

  return (
    <section className="mt-8 rounded-3xl border border-cyan-200 bg-cyan-50/40 p-5 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
            Getting started
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
            Complete the evidence chain
          </h2>
        </div>
        <p className="text-xs font-medium text-slate-500">
          {setup.completedCount} of {total} done
        </p>
      </div>

      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
        Each step depends on the one before it. Coverage stays at zero until
        approved intent is linked to an approved test, and a release cannot be
        judged until something has actually run.
      </p>

      <ol className="mt-6 space-y-2">
        {setup.steps.map((step, index) => {
          const isNext = index === nextIndex;
          return (
            <li
              key={step.key}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 ${
                step.done
                  ? "border-emerald-200 bg-white"
                  : isNext
                    ? "border-cyan-300 bg-white shadow-sm"
                    : "border-slate-200 bg-white/60"
              }`}
            >
              <div className="flex min-w-0 items-start gap-3">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    step.done
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {step.done ? "✓" : index + 1}
                </span>
                <div className="min-w-0">
                  <p
                    className={`text-sm font-semibold ${
                      step.done ? "text-slate-500 line-through" : "text-slate-900"
                    }`}
                  >
                    {step.title}
                    {step.done ? (
                      <span className="ml-2 font-normal text-slate-400 no-underline">
                        {step.count}
                      </span>
                    ) : null}
                  </p>
                  {/* The reason is only shown for the step being acted on.
                      Six explanations at once is a wall of text nobody reads. */}
                  {isNext ? (
                    <p className="mt-1 text-xs leading-5 text-slate-600">{step.detail}</p>
                  ) : null}
                </div>
              </div>

              {!step.done && isNext && canAct ? (
                <Link
                  href={step.href}
                  className="shrink-0 rounded-xl bg-slate-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
                >
                  {step.actionLabel} →
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
