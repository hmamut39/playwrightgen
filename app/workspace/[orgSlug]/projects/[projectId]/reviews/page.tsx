import Link from "next/link";

import { LocalTime } from "@/components/workspace/local-time";
import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { personName } from "@/lib/format/person-name";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { PendingButton } from "@/components/workspace/pending-button";
import { getReviewQueue, type ReviewItem } from "@/lib/services/review-queue";
import { approveTestCase } from "@/lib/services/test-cases";

const KIND_LABEL = {
  requirement: "Requirement",
  testCase: "Test case",
  automation: "Automation",
} as const;

const KIND_STYLE = {
  requirement: "bg-sky-50 text-sky-800",
  testCase: "bg-violet-50 text-violet-800",
  automation: "bg-cyan-50 text-cyan-800",
} as const;

function waitingFor(days: number | null) {
  if (days === null) return null;
  if (days < 1) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

function ReviewList({ items, empty }: { items: ReviewItem[]; empty: string }) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-600">
        {empty}
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const waited = waitingFor(item.waitingDays);
        return (
          <li key={`${item.kind}-${item.id}`}>
            <Link
              href={item.href}
              className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="min-w-0">
                <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_STYLE[item.kind]}`}>
                  {KIND_LABEL[item.kind]}
                </span>
                <span className="text-sm font-semibold text-slate-900">{item.title}</span>
                <span className="mt-1 block text-xs text-slate-500">
                  Submitted by {personName(item.submittedBy)}
                  {item.submittedAt ? (
                    <>
                      {" "}· <LocalTime value={item.submittedAt} />
                    </>
                  ) : null}
                  {item.reason === "own_submission"
                    ? " · you submitted this, so someone else approves it"
                    : null}
                </span>
                {item.evidence.provenChecks !== null ||
                item.evidence.authoredByAgent ||
                item.evidence.verifies ? (
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {item.evidence.provenChecks !== null ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
                        passed on the live page · {item.evidence.provenChecks} check
                        {item.evidence.provenChecks === 1 ? "" : "s"}
                      </span>
                    ) : null}
                    {item.evidence.authoredByAgent ? (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                        proposed by {item.evidence.authoredByAgent}
                      </span>
                    ) : null}
                    {item.evidence.verifies ? (
                      <span className="truncate text-xs text-slate-500">
                        verifies &ldquo;{item.evidence.verifies}&rdquo;
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
              {waited ? (
                <span
                  className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    (item.waitingDays ?? 0) >= 3
                      ? "bg-amber-50 text-amber-800"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  waiting {waited}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function ReviewQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
  searchParams: Promise<{ approved?: string; refused?: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const { approved, refused } = await searchParams;
  const queue = await getReviewQueue({ orgSlug, projectId });
  const path = `/workspace/${orgSlug}/projects/${projectId}/reviews`;

  /**
   * Test cases in this reader's turn that already passed on the live page.
   *
   * Accepting four tests that each carry a passing run should not cost four
   * page loads. This is only the ones a run has already proven: anything else
   * is a judgement someone has to make by reading it, and hurrying that would
   * defeat the point of the gate.
   */
  const provenForMe = queue.yours.filter(
    (item) => item.kind === "testCase" && item.evidence.provenChecks !== null,
  );

  async function approveProvenAction() {
    "use server";
    const queueNow = await getReviewQueue({ orgSlug, projectId });
    const proven = queueNow.yours.filter(
      (item) => item.kind === "testCase" && item.evidence.provenChecks !== null,
    );
    let done = 0;
    let stopped = 0;
    for (const item of proven) {
      // One at a time through the same service as the single-item button, so
      // every rule still applies -- above all that nobody approves their own
      // work. A refusal is counted and reported, never swallowed.
      try {
        await approveTestCase({ orgSlug, projectId, testCaseId: item.id });
        done += 1;
      } catch {
        stopped += 1;
      }
    }
    revalidatePath(path);
    redirect(`${path}?approved=${done}${stopped ? `&refused=${stopped}` : ""}`);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <ProjectNavigation organizationSlug={orgSlug} projectId={projectId} />

      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Reviews</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
          Waiting for review
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Everything submitted for review in this project, oldest first.
          Approving is what turns a draft into evidence a release can rely on.
        </p>
      </header>

      {approved ? (
        <p
          role="status"
          className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900"
        >
          {approved} test{approved === "1" ? "" : "s"} approved.
          {refused ? ` ${refused} could not be, and stayed where they were.` : ""}
        </p>
      ) : null}

      {provenForMe.length > 1 ? (
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-slate-900">
            {provenForMe.length} of these already passed on the live page
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Each one ran and passed, and its run is kept with it. You can accept them together, or open any of them
            first &mdash; approving is still what makes them count.
          </p>
          <form action={approveProvenAction} className="mt-3">
            <PendingButton
              pendingLabel="Approving…"
              className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Approve the {provenForMe.length} proven tests
            </PendingButton>
          </form>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold text-slate-950">
          Your turn{queue.yours.length ? ` · ${queue.yours.length}` : ""}
        </h2>
        <ReviewList
          items={queue.yours}
          empty="Nothing is waiting for you to approve."
        />
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-950">
          Waiting for someone else{queue.others.length ? ` · ${queue.others.length}` : ""}
        </h2>
        <ReviewList
          items={queue.others}
          empty="Nothing is waiting on anyone else."
        />
      </section>
    </div>
  );
}
