"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";

/**
 * The proposal panel, and what came back from it.
 *
 * The first version was a plain form. It ran for half a minute with no sign of
 * life, created its drafts on a different tab, and threw away the questions the
 * model raised, so the honest reaction to pressing the button was "where did
 * that go?". A generation people cannot see the result of is worse than no
 * generation: it teaches them the button does nothing.
 *
 * The result is rendered here rather than persisted. The drafts themselves are
 * durable and appear in the coverage list below on the next load; what is shown
 * here is the reading of that particular run -- what it made and what it could
 * not decide -- which belongs to the moment someone pressed the button.
 */

export type ProposalState = {
  status: "idle" | "created" | "error";
  created: Array<{ id: string; title: string; coverage: string; rationale: string }>;
  openQuestions: string[];
  message: string;
};

export const initialProposalState: ProposalState = {
  status: "idle",
  created: [],
  openQuestions: [],
  message: "",
};

const coverageLabel: Record<string, string> = {
  HAPPY_PATH: "Main path",
  NEGATIVE: "Failure case",
  BOUNDARY: "Boundary",
  PERMISSION: "Permissions",
  RESILIENCE: "Resilience",
};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      disabled={pending}
      aria-busy={pending}
      className="shrink-0 rounded-xl bg-violet-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-violet-400"
    >
      {pending ? "Reading the requirement…" : "Propose Test Cases"}
    </button>
  );
}

function Pending() {
  const { pending } = useFormStatus();
  if (!pending) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className="mt-4 rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm leading-6 text-slate-600"
    >
      Working through the acceptance criteria and drafting the Test Cases that
      would verify them. This usually takes 20&ndash;40 seconds.
    </p>
  );
}

export function ProposeTestCases({
  action,
  testCasesHref,
}: {
  action: (state: ProposalState, formData: FormData) => Promise<ProposalState>;
  testCasesHref: string;
}) {
  const [state, formAction] = useActionState(action, initialProposalState);

  return (
    <section className="mt-8 rounded-3xl border border-violet-200 bg-violet-50/40 p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">
        Coverage
      </p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
        Propose Test Cases for this requirement
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
        Reads this approved requirement and drafts the Test Cases that would
        verify it, each one linked to this requirement from the moment it is
        created. They arrive as drafts: nothing counts as coverage until you
        review and approve it, exactly as if you had written it yourself.
      </p>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
        It has not seen your application, so it will not invent URLs, selectors
        or credentials. Anything this requirement leaves undecided comes back as
        a question for you rather than a guess.
      </p>

      <form action={formAction} className="mt-5 flex flex-col gap-3 sm:flex-row">
        <input
          name="guidance"
          maxLength={2000}
          placeholder="Optional: known constraints, roles, or areas to focus on"
          className="min-w-0 flex-1 rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60"
        />
        <SubmitButton />
      </form>
      <Pending />

      {state.status === "error" ? (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-900">
          {state.message} Nothing was created, and the requirement is unchanged.
        </p>
      ) : null}

      {state.status === "created" ? (
        <div className="mt-6 rounded-2xl border border-violet-200 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-950">
              {state.created.length} draft{state.created.length === 1 ? "" : "s"} created
            </h3>
            <Link
              href={testCasesHref}
              className="text-sm font-semibold text-violet-700 hover:text-violet-800"
            >
              Open Test Cases →
            </Link>
          </div>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Each one is linked to this requirement and waiting for review. None of
            them counts as coverage until it is approved.
          </p>

          <ul className="mt-4 space-y-3">
            {state.created.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-slate-200 bg-slate-50/70 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-950">{item.title}</p>
                  <span className="rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-800">
                    {coverageLabel[item.coverage] ?? item.coverage}
                  </span>
                </div>
                {/* Why this test exists, in the requirement's own terms. Without
                    it a reviewer has to reverse-engineer the intent before they
                    can judge whether the coverage is right. */}
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.rationale}</p>
              </li>
            ))}
          </ul>

          {state.openQuestions.length ? (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <h4 className="text-sm font-semibold text-slate-950">
                Questions this requirement does not answer
              </h4>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                These were left open rather than guessed. Deciding them and
                revising the requirement will produce sharper coverage.
              </p>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
                {state.openQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
