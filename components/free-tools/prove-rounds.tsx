"use client";

import type { ProveRound } from "@/lib/free-tools/prove-loop";

/**
 * What the loop did, round by round, as it happens.
 *
 * The failures are shown, not hidden: "failed at this step, fixed it, ran
 * again, passed" is the evidence that the final code was proven rather than
 * merely produced. It also keeps a minute of waiting legible, which a spinner
 * does not.
 */

const DONE_TEXT: Record<Extract<ProveRound, { kind: "done" }>["reason"], string> = {
  passed: "Passed on the live page.",
  partial: "Nothing failed, but some steps could not run here.",
  out_of_fixes: "Still failing after the fixes included in one attempt. The draft and the failure are below; you can fix and run again.",
  not_fixable: "The run failed without a step that could be fixed automatically.",
  limit: "Stopped: today's free runs are used up.",
  error: "Stopped before it could be proven.",
};

function line(round: ProveRound): { icon: string; tone: string; text: string } {
  switch (round.kind) {
    case "generating":
      return { icon: "1", tone: "text-slate-500", text: "Reading the page and writing the test…" };
    case "generated":
      return { icon: "✓", tone: "text-emerald-600", text: `Draft written: ${round.title}` };
    case "running":
      return { icon: `${round.attempt}`, tone: "text-slate-500", text: `Running it on the live page (attempt ${round.attempt})…` };
    case "ran":
      return round.verdict === "passed"
        ? { icon: "✓", tone: "text-emerald-600", text: `Passed: ${round.passed} checks.` }
        : round.verdict === "partial"
          ? { icon: "–", tone: "text-amber-600", text: `${round.passed} passed, ${round.skipped} could not run here.` }
          : { icon: "✗", tone: "text-red-600", text: `Failed at "${round.failingStep ?? "a step"}" (${round.passed} passed).` };
    case "fixing":
      return { icon: "→", tone: "text-slate-500", text: `Fixing "${round.failingStep}" from what the page really had…` };
    case "fixed":
      return { icon: "✓", tone: "text-cyan-700", text: `Fixed: ${round.explanation}` };
    case "done":
      return {
        icon: round.reason === "passed" ? "✓" : round.reason === "partial" ? "–" : "!",
        tone: round.reason === "passed" ? "text-emerald-600" : round.reason === "partial" ? "text-amber-600" : "text-red-600",
        text: round.message ? `${DONE_TEXT[round.reason]} ${round.message}` : DONE_TEXT[round.reason],
      };
  }
}

export function ProveRounds({ rounds, working }: { rounds: ProveRound[]; working: boolean }) {
  if (rounds.length === 0) return null;
  return (
    <section
      role="status"
      aria-live="polite"
      className="mt-8 rounded-[2rem] border border-cyan-200 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="text-sm font-bold text-slate-950">
          {working ? "Making the test pass on your page" : "How this test was proven"}
        </p>
        <p className="text-xs text-slate-500">Generate, run, fix, run again &middot; usually 1&ndash;3 minutes</p>
      </div>
      <ol className="mt-4 space-y-2">
        {rounds.map((round, index) => {
          const item = line(round);
          const last = index === rounds.length - 1;
          return (
            <li key={`${round.kind}-${index}`} className="flex gap-3 text-sm leading-6">
              <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold ${item.tone}`}>
                {item.icon}
              </span>
              <span className={last && working ? "text-slate-900" : "text-slate-600"}>
                {item.text}
                {last && working ? <span className="ml-1 animate-pulse text-cyan-600 motion-reduce:animate-none">…</span> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
