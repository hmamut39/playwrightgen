import { AiAllowanceNotice, aiAllowanceNotice } from "@/components/workspace/ai-allowance-notice";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { ProjectNavigation } from "@/components/workspace/project-navigation";
import { SetupChecklist } from "@/components/workspace/setup-checklist";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import {
  archiveProject,
  getProjectOverview,
  restoreProject,
  updateProject,
} from "@/lib/services/projects";
import { getProjectSetup } from "@/lib/services/project-setup";
import { personName } from "@/lib/format/person-name";
import { LocalTime } from "@/components/workspace/local-time";
import { PendingButton } from "@/components/workspace/pending-button";
import { humanLabel } from "@/lib/format/label";
import { startAutomationArtifactGeneration } from "@/lib/services/automation-artifacts";
import {
  describeWebhook,
  LiveChecksError,
  readLiveChecksSummary,
  runLiveChecksForProject,
  setLiveChecks,
  setLiveChecksAlertEmail,
  setLiveChecksWebhook,
} from "@/lib/services/live-checks";

// "Run now" finishes a round of checks after the page has answered.
export const maxDuration = 300;

export default async function ProjectOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
  searchParams: Promise<{ webhook?: string; notice?: string; email?: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const { webhook: webhookNotice, notice, email: emailNotice } = await searchParams;
  const [overview, setup, context] = await Promise.all([
    getProjectOverview({ orgSlug, projectId, allowArchived: true }),
    getProjectSetup({ orgSlug, projectId }),
    requireWorkspaceContext({ orgSlug, projectId }),
  ]);
  const { project } = overview;
  const liveSummary = readLiveChecksSummary(project.liveChecksLastSummary);
  const webhookLabel = describeWebhook(project.liveChecksWebhookUrl);
  const overviewPath = `/workspace/${orgSlug}/projects/${projectId}/overview`;
  const canGenerate = context.can("automation:generate");

  async function liveUrlAction(formData: FormData) {
    "use server";
    await updateProject({ orgSlug, projectId, liveUrl: String(formData.get("liveUrl") ?? "").trim() });
    revalidatePath(`/workspace/${orgSlug}/projects/${projectId}/overview`);
  }

  async function liveChecksAction(formData: FormData) {
    "use server";
    const intent = formData.get("intent");
    if (intent === "enable" || intent === "disable") {
      await setLiveChecks({ orgSlug, projectId, enabled: intent === "enable" });
    }
    if (intent === "enable" || intent === "run") {
      // Checked for permission above (enable) or here (run); the round itself
      // runs after the page has answered, since it can take a few minutes.
      if (intent === "run") await setLiveChecks({ orgSlug, projectId, enabled: true });
      after(async () => {
        await runLiveChecksForProject(projectId, { deadline: Date.now() + 240_000 }).catch((error: unknown) =>
          console.error("[live-checks] run now failed", error),
        );
      });
    }
    revalidatePath(`/workspace/${orgSlug}/projects/${projectId}/overview`);
  }

  async function regenerateAction(formData: FormData) {
    "use server";
    const testCaseId = String(formData.get("testCaseId") ?? "");
    const automationArtifactId = String(formData.get("automationArtifactId") ?? "");
    try {
      await startAutomationArtifactGeneration(
        {
          orgSlug,
          projectId,
          testCaseId,
          engine: "PLAYWRIGHT_BROWSER",
          guidance: "Daily live checks could not run the approved version. Build every locator and URL from the live page; read only credentials and test data from process.env.",
        },
        after,
      );
    } catch (error) {
      const refused = aiAllowanceNotice(error);
      if (refused) redirect(`${overviewPath}?notice=${refused}#live-checks`);
      throw error;
    }
    revalidatePath(overviewPath);
    redirect(`/workspace/${orgSlug}/projects/${projectId}/automation/${automationArtifactId}`);
  }

  async function webhookAction(formData: FormData) {
    "use server";
    const remove = formData.get("intent") === "remove";
    try {
      await setLiveChecksWebhook({ orgSlug, projectId, webhookUrl: remove ? "" : String(formData.get("webhookUrl") ?? "") });
    } catch (error) {
      if (error instanceof LiveChecksError && error.code === "invalid_webhook") redirect(`${overviewPath}?webhook=invalid#live-checks`);
      throw error;
    }
    revalidatePath(overviewPath);
    redirect(`${overviewPath}?webhook=${remove ? "removed" : "saved"}#live-checks`);
  }

  async function alertEmailAction(formData: FormData) {
    "use server";
    const remove = formData.get("intent") === "remove";
    try {
      await setLiveChecksAlertEmail({
        orgSlug,
        projectId,
        email: remove ? "" : String(formData.get("alertEmail") ?? ""),
      });
    } catch (error) {
      if (error instanceof LiveChecksError && error.code === "invalid_email") {
        redirect(`${overviewPath}?email=invalid#live-checks`);
      }
      if (error instanceof LiveChecksError && error.code === "email_not_a_member") {
        redirect(`${overviewPath}?email=stranger#live-checks`);
      }
      throw error;
    }
    revalidatePath(overviewPath);
    redirect(`${overviewPath}?email=${remove ? "removed" : "saved"}#live-checks`);
  }

  async function transitionAction(formData: FormData) {
    "use server";
    const intent = formData.get("intent");
    if (intent === "archive") {
      await archiveProject({ orgSlug, projectId });
    } else if (intent === "restore") {
      await restoreProject({ orgSlug, projectId });
    } else {
      throw new Error("Invalid project transition intent");
    }
    revalidatePath(`/workspace/${orgSlug}`);
    revalidatePath(`/workspace/${orgSlug}/projects/${projectId}/overview`);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <ProjectNavigation organizationSlug={orgSlug} projectId={projectId} />
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Project overview</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{project.name}</h1>
          <p className="mt-2 text-sm text-slate-500">{project.slug}</p>
        </div>
        {overview.canArchive ? (
          <form action={transitionAction}>
            <input
              name="intent"
              type="hidden"
              value={project.status === "ACTIVE" ? "archive" : "restore"}
            />
            <button className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">
              {project.status === "ACTIVE" ? "Archive project" : "Restore project"}
            </button>
          </form>
        ) : null}
      </div>

      {/* The landing page for a project is where someone arrives immediately
          after creating one, so the chain belongs here rather than only on
          Quality, which a new user has no reason to open. It hides itself once
          every step is done, so an established project pays nothing for it. */}
      <SetupChecklist
        setup={setup}
        canAct={context.can("requirement:create")}
        coverHref={`/workspace/${orgSlug}/projects/${projectId}/cover`}
      />

      {/* Where this project runs. With it, automation generated for an approved
          Test Case is run and fixed before a person reviews it, so a reviewer
          reads code that was tried rather than only written. */}
      <section className="mt-8 rounded-2xl border border-cyan-200 bg-cyan-50/40 p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Proving</p>
        <h2 className="mt-2 text-lg font-semibold">Where this project runs</h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
          Give a public address of this product and PlaywrightGen will run each newly generated test there, fix a failing
          step from what the page really showed, and record the result on the version &mdash; before anyone reviews it.
          Leave it empty and nothing is run.
        </p>
        {overview.canUpdate ? (
          <form action={liveUrlAction} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              name="liveUrl"
              type="url"
              defaultValue={project.liveUrl ?? ""}
              maxLength={2_000}
              placeholder="https://staging.our-app.example.com/"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-cyan-600 focus-visible:ring-2 focus-visible:ring-cyan-500/60"
            />
            <PendingButton pendingLabel="Saving…" className="rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800">
              {project.liveUrl ? "Update" : "Save"}
            </PendingButton>
          </form>
        ) : (
          <p className="mt-4 text-sm font-medium text-slate-700">{project.liveUrl || "Not set. A project lead can add it."}</p>
        )}

        {project.liveUrl ? (
          <div id="live-checks" className="mt-6 scroll-mt-6 border-t border-cyan-200 pt-5">
            <AiAllowanceNotice notice={notice} orgSlug={orgSlug} />
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Daily live checks {project.liveChecksEnabled ? <span className="ml-1 rounded-full bg-emerald-600 px-2 py-0.5 text-xs text-white">On</span> : <span className="ml-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">Off</span>}
                </p>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                  Every day, each approved browser test runs on this address and the result is recorded under Test Runs. A
                  test that starts failing shows as a regression on Quality and Release &mdash; no CI needed, and no AI
                  allowance used. Tests that need a sign-in account are skipped, because accounts are never stored.
                </p>
              </div>
              {overview.canUpdate ? (
                <form action={liveChecksAction} className="flex shrink-0 flex-wrap gap-2">
                  {project.liveChecksEnabled ? (
                    <>
                      <button name="intent" value="run" className="rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-800">Run now</button>
                      <button name="intent" value="disable" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">Turn off</button>
                    </>
                  ) : (
                    <button name="intent" value="enable" className="rounded-lg bg-cyan-700 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-800">Turn on and run now</button>
                  )}
                </form>
              ) : null}
            </div>
            {liveSummary ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
                <p className="font-medium text-slate-900">
                  Last checked <LocalTime value={new Date(liveSummary.ranAt)} />: {liveSummary.passed} passed
                  {liveSummary.failed ? <span className="font-semibold text-red-700"> &middot; {liveSummary.failed} failing</span> : null}
                  {liveSummary.partial ? <> &middot; {liveSummary.partial} partly run</> : null}
                  {liveSummary.checked === 0 ? " · nothing could be checked yet" : null}
                </p>
                {liveSummary.checked === 0 && liveSummary.notChecked.length === 0 ? (
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    No browser automation is approved in this project yet. Approve one on its{" "}
                    <a href={`/workspace/${orgSlug}/projects/${projectId}/automation`} className="font-semibold text-cyan-800 underline">
                      Automation
                    </a>{" "}
                    page and it is checked in the next round.
                  </p>
                ) : null}
                {liveSummary.failing.length ? (
                  <ul className="mt-3 space-y-2">
                    {liveSummary.failing.slice(0, 10).map((entry) => (
                      <li key={entry.testCaseId} className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2">
                        <a href={`/workspace/${orgSlug}/projects/${projectId}/test-cases/${entry.testCaseId}`} className="font-semibold text-red-800 underline">
                          {entry.title}
                        </a>
                        {entry.newToday ? <span className="ml-2 rounded-full bg-red-700 px-2 py-0.5 text-xs font-semibold text-white">Started failing</span> : null}
                        {entry.detail ? <p className="mt-1 break-words text-xs text-red-900/80">{entry.detail.split("\n")[0]}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {liveSummary.flaky.length ? (
                  <p className="mt-3 text-xs font-medium text-amber-800">
                    Flaky (failed once, passed when run again): {liveSummary.flaky.map((entry) => entry.title).join(", ")}
                  </p>
                ) : null}
                {liveSummary.recovered.length ? (
                  <p className="mt-3 text-xs font-medium text-emerald-800">
                    Passing again: {liveSummary.recovered.map((entry) => entry.title).join(", ")}
                  </p>
                ) : null}
                {liveSummary.alert ? (
                  <p className={`mt-2 text-xs ${liveSummary.alert === "sent" ? "text-slate-500" : "font-semibold text-amber-800"}`}>
                    {liveSummary.alert === "sent" ? "The change was posted to your channel." : "The change could not be posted to your channel. Check the webhook below."}
                  </p>
                ) : null}
                {liveSummary.notChecked.length ? (
                  <ul className="mt-2 space-y-1 text-xs text-slate-500">
                    {liveSummary.notChecked.slice(0, 8).map((entry) => (
                      <li key={entry.title + entry.reason} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                        <span>Not checked: {entry.title} &mdash; {entry.reason}</span>
                        {entry.regenerate && entry.testCaseId && entry.automationArtifactId && canGenerate ? (
                          <form action={regenerateAction} className="shrink-0">
                            <input type="hidden" name="testCaseId" value={entry.testCaseId} />
                            <input type="hidden" name="automationArtifactId" value={entry.automationArtifactId} />
                            <PendingButton pendingLabel="Starting…" className="rounded-md border border-cyan-300 bg-white px-2 py-1 text-xs font-semibold text-cyan-800 hover:bg-cyan-50">
                              Generate again from the live page
                            </PendingButton>
                          </form>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : project.liveChecksEnabled ? (
              <p className="mt-4 text-xs text-slate-500">The first round is running; results appear here and under Test Runs within a few minutes.</p>
            ) : null}

            {project.liveChecksEnabled && overview.canUpdate ? (
              <div className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">Tell your team in Slack or Discord</p>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  When a test starts failing, or passes again, the round posts it to a channel. Paste the channel&rsquo;s
                  incoming webhook address. It is only used for this, and never shown again in full.
                </p>
                {webhookNotice === "invalid" ? (
                  <p role="alert" className="mt-2 text-xs font-semibold text-red-700">
                    That is not a Slack (https://hooks.slack.com/services/...) or Discord (https://discord.com/api/webhooks/...) webhook address.
                  </p>
                ) : webhookNotice === "saved" ? (
                  <p role="status" className="mt-2 text-xs font-semibold text-emerald-700">Saved. The next change is posted there.</p>
                ) : webhookNotice === "removed" ? (
                  <p role="status" className="mt-2 text-xs font-semibold text-slate-700">Removed. Changes show here only.</p>
                ) : null}
                <form action={webhookAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    name="webhookUrl"
                    type="url"
                    required
                    maxLength={2_000}
                    autoComplete="off"
                    aria-label="Incoming webhook address"
                    placeholder={webhookLabel ? `Posting to ${webhookLabel}. Paste a new address to change it.` : "https://hooks.slack.com/services/..."}
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-600 focus-visible:ring-2 focus-visible:ring-cyan-500/60"
                  />
                  <PendingButton pendingLabel="Saving…" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
                    {webhookLabel ? "Change" : "Save"}
                  </PendingButton>
                </form>
                {webhookLabel ? (
                  <form action={webhookAction} className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                    <span>Posting to {webhookLabel}.</span>
                    <button name="intent" value="remove" className="font-semibold text-slate-800 underline">Remove</button>
                  </form>
                ) : null}

                <div className="mt-5 border-t border-slate-200 pt-4">
                  <p className="text-sm font-semibold text-slate-900">Or by email</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    No Slack? The same message can go to an address instead. It has to belong to someone in this
                    workspace, so this can never be pointed at a stranger&rsquo;s inbox.
                  </p>
                  {emailNotice === "invalid" ? (
                    <p role="alert" className="mt-2 text-xs font-semibold text-red-700">That is not an email address.</p>
                  ) : emailNotice === "stranger" ? (
                    <p role="alert" className="mt-2 text-xs font-semibold text-red-700">
                      Nobody in this workspace uses that address. Invite them to the workspace first, or use an
                      address that is already a member.
                    </p>
                  ) : emailNotice === "saved" ? (
                    <p role="status" className="mt-2 text-xs font-semibold text-emerald-700">
                      Saved. The next change is mailed there.
                    </p>
                  ) : emailNotice === "removed" ? (
                    <p role="status" className="mt-2 text-xs font-semibold text-slate-700">Removed. No mail is sent.</p>
                  ) : null}
                  <form action={alertEmailAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <input
                      name="alertEmail"
                      type="email"
                      required
                      maxLength={320}
                      autoComplete="off"
                      aria-label="Address told when a check fails"
                      placeholder={project.liveChecksAlertEmail ?? "someone@yourteam.com"}
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-600 focus-visible:ring-2 focus-visible:ring-cyan-500/60"
                    />
                    <PendingButton pendingLabel="Saving…" className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
                      {project.liveChecksAlertEmail ? "Change" : "Save"}
                    </PendingButton>
                  </form>
                  {project.liveChecksAlertEmail ? (
                    <form action={alertEmailAction} className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                      <span>Mailing {project.liveChecksAlertEmail}.</span>
                      <button name="intent" value="remove" className="font-semibold text-slate-800 underline">Remove</button>
                    </form>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <dl className="grid gap-6 sm:grid-cols-2">
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</dt><dd className="mt-2 text-sm font-medium">{humanLabel(project.status)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Your role</dt><dd className="mt-2 text-sm font-medium">{humanLabel(overview.role)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Creator</dt><dd className="mt-2 text-sm font-medium">{personName(project.createdBy.displayName)}</dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Created</dt><dd className="mt-2 text-sm"><LocalTime value={project.createdAt} /></dd></div>
          <div><dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Updated</dt><dd className="mt-2 text-sm"><LocalTime value={project.updatedAt} /></dd></div>
        </dl>
        <div className="mt-8 border-t border-slate-200 pt-6">
          <h2 className="text-sm font-semibold">Description</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-600">{project.description || "No description provided."}</p>
        </div>
      </section>
    </div>
  );
}
