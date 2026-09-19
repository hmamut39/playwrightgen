import Link from "next/link";

import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { getOrganizationProjectRisk } from "@/lib/services/project-risk";
import { listProjects } from "@/lib/services/projects";
import { getOrganizationReviewCounts } from "@/lib/services/review-queue";
import { LocalTime } from "@/components/workspace/local-time";
import { humanLabel } from "@/lib/format/label";
import { readLiveChecksSummary, recentlyStartedFailing } from "@/lib/services/live-checks";

export default async function OrganizationWorkspacePage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const [context, projects, risk, reviewCounts] = await Promise.all([
    requireWorkspaceContext({ orgSlug }),
    listProjects({ orgSlug, includeArchived: true }),
    getOrganizationProjectRisk({ orgSlug }),
    getOrganizationReviewCounts({ orgSlug }),
  ]);
  const canCreate = context.can("project:create");
  const liveByProject = new Map(
    projects.flatMap((project) => {
      const summary = project.status === "ACTIVE" && project.liveChecksEnabled ? readLiveChecksSummary(project.liveChecksLastSummary) : null;
      return summary ? [[project.id, summary] as const] : [];
    }),
  );
  const liveNews = projects.flatMap((project) => {
    const started = recentlyStartedFailing(liveByProject.get(project.id) ?? null);
    return started.length ? [{ project, started }] : [];
  });

  return (
    <>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Workspace</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-2 text-sm text-slate-600">
            A project is one product or app you test: its requirements, test cases, automation and release evidence.
          </p>
        </div>
        {canCreate ? (
          <Link href={`/workspace/${orgSlug}/projects/new`} className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
            New project
          </Link>
        ) : null}
      </header>

      {liveNews.length ? (
        <section role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
          <p className="text-sm font-semibold text-red-900">A daily live check found tests that started failing</p>
          <ul className="mt-2 space-y-1 text-sm text-red-900">
            {liveNews.map(({ project, started }) => (
              <li key={project.id}>
                <Link href={`/workspace/${orgSlug}/projects/${project.id}/overview#live-checks`} className="font-semibold underline">
                  {project.name}
                </Link>
                : {started.slice(0, 3).map((entry) => entry.title).join(", ")}
                {started.length > 3 ? ` and ${started.length - 3} more` : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {projects.length === 0 ? (
        canCreate ? (
          <FirstProjectGuide href={`/workspace/${orgSlug}/projects/new`} />
        ) : (
          // Someone who joined without a project role sees nothing, and "when
          // your role allows it" did not tell them who can change that.
          <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-8">
            <h2 className="text-lg font-semibold">You&rsquo;re in, but not on a project yet</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Ask a workspace owner or admin to add you. They can do it from
              the project&rsquo;s <span className="font-medium text-slate-800">Team</span> tab,
              and the project appears here as soon as they do.
            </p>
          </section>
        )
      ) : (
        <section className="mt-8 grid gap-4 xl:grid-cols-2">
          {projects.map((project) => {
            const projectRisk = risk.get(project.id);
            return (
            <Link
              key={project.id}
              href={`/workspace/${orgSlug}/projects/${project.id}/health`}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-slate-950">{project.name}</h2>
                  <p className="mt-1 text-xs text-slate-400">{project.slug}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${project.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {humanLabel(project.status)}
                </span>
              </div>
              <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-600">
                {project.description || "No description"}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {reviewCounts.get(project.id) ? (
                  <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800">
                    {reviewCounts.get(project.id)} waiting for review
                  </span>
                ) : null}
                {projectRisk && projectRisk.regressions > 0 ? (
                  <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                    {projectRisk.regressions} regression{projectRisk.regressions === 1 ? "" : "s"}
                  </span>
                ) : null}
                {liveByProject.get(project.id)?.failing.length ? (
                  <span className="rounded-full bg-red-600 px-2.5 py-1 text-xs font-semibold text-white">
                    Live check: {liveByProject.get(project.id)?.failing.length} failing
                  </span>
                ) : liveByProject.get(project.id)?.checked ? (
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                    Live check passing
                  </span>
                ) : null}
                {projectRisk && projectRisk.flaky > 0 ? (
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                    {projectRisk.flaky} flaky
                  </span>
                ) : null}
                {projectRisk && projectRisk.openFindings > 0 ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    {projectRisk.openFindings} unreviewed finding{projectRisk.openFindings === 1 ? "" : "s"}
                  </span>
                ) : null}
                {projectRisk?.lastEvidenceAt ? null : (
                  <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-400">
                    No run evidence
                  </span>
                )}
              </div>
              <p className="mt-3 text-xs text-slate-400">
                {projectRisk?.lastEvidenceAt ? (
                  <>
                    Last evidence <LocalTime value={projectRisk.lastEvidenceAt} style="date" /> · updated{" "}
                    <LocalTime value={project.updatedAt} style="date" />
                  </>
                ) : (
                  <>
                    Updated <LocalTime value={project.updatedAt} />
                  </>
                )}
              </p>
            </Link>
            );
          })}
        </section>
      )}
    </>
  );
}

const FIRST_STEPS = [
  {
    title: "Create a project",
    detail: "One per product or app you test, for example \"Checkout web app\".",
  },
  {
    title: "Write what it must do",
    detail: "Add a requirement in plain words. AI checks it for gaps, and a lead approves it.",
  },
  {
    title: "Turn it into tests",
    detail: "AI proposes test cases from the requirement and writes the Playwright code. People review and approve both.",
  },
  {
    title: "Run and ship with proof",
    detail: "Your CI runs the tests. Results come back here, and the Release page shows whether it is safe to ship.",
  },
];

/**
 * What a brand-new workspace shows instead of an empty list.
 *
 * "No projects yet" was accurate and gave no reason to start. The path through
 * the product -- intent, then tests, then evidence -- is not obvious to someone
 * who has never seen it, so it is stated here in four plain steps, with the one
 * button that begins it.
 */
function FirstProjectGuide({ href }: { href: string }) {
  return (
    <section className="mt-8 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="bg-slate-950 px-6 py-7 text-white sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">Start here</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          From a requirement to a release you can prove
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
          Four steps. The first takes a minute, and each screen after it tells you what comes next.
        </p>
      </div>
      <ol className="grid gap-px bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
        {FIRST_STEPS.map((step, index) => (
          <li key={step.title} className="bg-white p-5">
            <span
              className={`grid h-8 w-8 place-items-center rounded-full text-sm font-bold ${
                index === 0 ? "bg-cyan-500 text-white" : "bg-slate-100 text-slate-600"
              }`}
            >
              {index + 1}
            </span>
            <h3 className="mt-3 text-sm font-semibold text-slate-950">{step.title}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">{step.detail}</p>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 px-6 py-5 sm:px-8">
        <Link
          href={href}
          className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Create your first project
        </Link>
        <p className="text-sm text-slate-500">You can invite your team once the project exists.</p>
      </div>
    </section>
  );
}
