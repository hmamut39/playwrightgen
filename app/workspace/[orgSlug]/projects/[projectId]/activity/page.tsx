import Link from "next/link";

import { ListEmptyState, ListPagination } from "@/components/workspace/list-controls";
import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { personName } from "@/lib/format/person-name";
import { groupActivityByDay, listProjectActivity } from "@/lib/services/activity-feed";

/**
 * What changed while you were away.
 *
 * The product recorded every approval, version, run and suggestion from its
 * first commit and never showed any of it, so there was nothing to come back
 * for: a person configured the workspace, left, and had no way to learn that
 * overnight CI had turned a passing test red or that a colleague had approved
 * something.
 *
 * Grouped by day and newest first, because the question people arrive with is
 * "what happened since yesterday", not "what is the two hundredth most recent
 * event".
 */

function dayLabel(day: string, today: string, yesterday: string) {
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function ProjectActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const { page } = await searchParams;
  const activity = await listProjectActivity({
    orgSlug,
    projectId,
    page: page ? Number(page) : undefined,
  });
  const basePath = `/workspace/${orgSlug}/projects/${projectId}/activity`;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const days = groupActivityByDay(activity.items);

  return (
    <div className="mx-auto max-w-5xl">
      <ProjectNavigation organizationSlug={orgSlug} projectId={projectId} />

      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
          Activity
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
          What changed
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Every approval, revision, run and analysis in this project, newest
          first. This is the same record the audit trail is built from, so
          nothing here can be edited or removed.
        </p>
      </header>

      {activity.items.length === 0 ? (
        <ListEmptyState
          meta={activity}
          basePath={basePath}
          emptyTitle="Nothing has happened yet"
          emptyDescription="Approvals, generated automation and recorded runs will appear here as they happen."
        />
      ) : (
        <>
          <div className="mt-8 space-y-8">
            {days.map(({ day, entries }) => (
              <section key={day}>
                <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                  {dayLabel(day, today, yesterday)}
                </h2>
                <ol className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  {entries.map((entry) => {
                    const line = (
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-4">
                        <p className="min-w-0 text-sm leading-6 text-slate-700">
                          <span className="font-semibold text-slate-950">
                            {entry.actorName ? personName(entry.actorName) : "The system"}
                          </span>{" "}
                          {entry.summary}
                        </p>
                        <span className="shrink-0 text-xs text-slate-400">
                          {entry.createdAt.toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    );

                    return (
                      <li key={entry.id} className="border-b border-slate-100 last:border-b-0">
                        {/* Linked only where the target has a page of its own.
                            A row that looks clickable and goes nowhere teaches
                            people to stop clicking. */}
                        {entry.href ? (
                          <Link href={entry.href} className="block transition hover:bg-slate-50">
                            {line}
                          </Link>
                        ) : (
                          line
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>

          <ListPagination meta={activity} basePath={basePath} noun="events" />
        </>
      )}
    </div>
  );
}
