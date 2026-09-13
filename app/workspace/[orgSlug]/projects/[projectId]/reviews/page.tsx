import Link from "next/link";

import { LocalTime } from "@/components/workspace/local-time";
import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { personName } from "@/lib/format/person-name";
import { getReviewQueue, type ReviewItem } from "@/lib/services/review-queue";

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
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const queue = await getReviewQueue({ orgSlug, projectId });

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
