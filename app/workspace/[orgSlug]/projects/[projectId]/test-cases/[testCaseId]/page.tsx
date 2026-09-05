import { revalidatePath } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  generateAutomationArtifact,
  listAutomationArtifacts,
} from "@/lib/services/automation-artifacts";
import { MAX_PAGE_SIZE } from "@/lib/services/list-query";
import { listRequirements } from "@/lib/services/requirements";
import {
  approveTestCase,
  archiveTestCase,
  getTestCaseDetail,
  linkRequirementToTestCase,
  readTestCaseList,
  requestTestCaseChanges,
  submitTestCaseForReview,
  unlinkRequirementFromTestCase,
  updateTestCaseDraft,
} from "@/lib/services/test-cases";

const statusStyle = {
  DRAFT: "bg-slate-100 text-slate-700", IN_REVIEW: "bg-amber-50 text-amber-800",
  APPROVED: "bg-emerald-50 text-emerald-700", ARCHIVED: "bg-slate-100 text-slate-500",
} as const;

function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export default async function TestCaseDetailPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string; testCaseId: string }>;
}) {
  const { orgSlug, projectId, testCaseId } = await params;
  const [detail, requirements, automationArtifacts] = await Promise.all([
    getTestCaseDetail({ orgSlug, projectId, testCaseId, allowArchived: true }),
    listRequirements({ orgSlug, projectId, pageSize: MAX_PAGE_SIZE }),
    listAutomationArtifacts({ orgSlug, projectId, testCaseId }),
  ]);
  const { testCase } = detail;
  const testPath = `/workspace/${orgSlug}/projects/${projectId}/test-cases/${testCaseId}`;
  const listPath = `/workspace/${orgSlug}/projects/${projectId}/test-cases`;
  const steps = readTestCaseList(testCase.steps);
  const expectedResults = readTestCaseList(testCase.expectedResults);
  const linkedIds = new Set(testCase.requirementLinks.map((link) => link.requirementId));
  const availableRequirements = requirements.items.filter((requirement) => !linkedIds.has(requirement.id));
  const isReviewComplete = Boolean(testCase.objective.trim() && steps.length && expectedResults.length);

  async function updateAction(formData: FormData) {
    "use server";
    await updateTestCaseDraft({
      orgSlug, projectId, testCaseId,
      expectedVersion: Number(formData.get("expectedVersion")),
      title: String(formData.get("title") ?? ""),
      objective: String(formData.get("objective") ?? ""),
      preconditions: String(formData.get("preconditions") ?? ""),
      steps: lines(formData.get("steps")),
      expectedResults: lines(formData.get("expectedResults")),
      priority: String(formData.get("priority")) as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      type: String(formData.get("type")) as "FUNCTIONAL" | "END_TO_END" | "API" | "INTEGRATION" | "REGRESSION",
      tags: String(formData.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
    });
    revalidatePath(testPath); revalidatePath(listPath);
  }
  async function transitionAction(formData: FormData) {
    "use server";
    const input = { orgSlug, projectId, testCaseId };
    const intent = formData.get("intent");
    if (intent === "submit") await submitTestCaseForReview(input);
    else if (intent === "approve") await approveTestCase(input);
    else if (intent === "request-changes") await requestTestCaseChanges(input);
    else if (intent === "archive") await archiveTestCase(input);
    else throw new Error("Invalid test case transition intent");
    revalidatePath(testPath); revalidatePath(listPath);
  }
  async function linkAction(formData: FormData) {
    "use server";
    await linkRequirementToTestCase({ orgSlug, projectId, testCaseId, requirementId: String(formData.get("requirementId")) });
    revalidatePath(testPath);
  }
  async function unlinkAction(formData: FormData) {
    "use server";
    await unlinkRequirementFromTestCase({ orgSlug, projectId, testCaseId, requirementId: String(formData.get("requirementId")) });
    revalidatePath(testPath);
  }
  async function automateAction(formData: FormData) {
    "use server";
    const engine = String(formData.get("engine"));
    if (engine !== "PLAYWRIGHT_BROWSER" && engine !== "PLAYWRIGHT_API") {
      throw new Error("Invalid automation engine");
    }
    const artifact = await generateAutomationArtifact({
      orgSlug,
      projectId,
      testCaseId,
      engine,
      guidance: String(formData.get("guidance") ?? ""),
    });
    redirect(`/workspace/${orgSlug}/projects/${projectId}/automation/${artifact.id}`);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link href={listPath} className="text-sm font-medium text-violet-700 hover:text-violet-900">← Test Cases</Link>
      <header className="mt-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle[testCase.status]}`}>{testCase.status.replace("_", " ")}</span>
            <span className="text-xs text-slate-400">Version {testCase.currentVersionNumber}</span>
            <span className="rounded bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700">{testCase.type.replaceAll("_", " ")}</span>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{testCase.title}</h1>
          <p className="mt-3 text-sm text-slate-500">{testCase.priority} priority · Automation: {testCase.automationStatus} · Owner: {testCase.owner.displayName || "Workspace member"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {testCase.status === "APPROVED" && detail.canCreateRun ? <Link href={`/workspace/${orgSlug}/projects/${projectId}/test-runs/new?testCaseId=${testCase.id}`} className="rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white">Create Test Run</Link> : null}
          {testCase.status === "DRAFT" && detail.canSubmit && isReviewComplete ? <form action={transitionAction}><input type="hidden" name="intent" value="submit" /><button className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Submit for review</button></form> : null}
          {testCase.status === "IN_REVIEW" && detail.canApprove ? <><form action={transitionAction}><input type="hidden" name="intent" value="request-changes" /><button className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold">Request changes</button></form><form action={transitionAction}><input type="hidden" name="intent" value="approve" /><button className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white">Approve</button></form></> : null}
          {testCase.status !== "ARCHIVED" && detail.canArchive ? <form action={transitionAction}><input type="hidden" name="intent" value="archive" /><button className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold">Archive</button></form> : null}
        </div>
      </header>

      {testCase.status === "DRAFT" && !isReviewComplete ? <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Add an objective, at least one step, and at least one expected result before review.</p> : null}

      {testCase.status === "DRAFT" && detail.canUpdate ? (
        <form action={updateAction} className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div><h2 className="text-lg font-semibold">Draft content</h2><p className="mt-1 text-sm text-slate-500">Every material save creates a new immutable version.</p></div>
          <input type="hidden" name="expectedVersion" value={testCase.currentVersionNumber} />
          <label className="block text-sm font-medium">Title<input name="title" required defaultValue={testCase.title} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60" /></label>
          <label className="block text-sm font-medium">Objective<textarea name="objective" rows={4} defaultValue={testCase.objective} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60" /></label>
          <label className="block text-sm font-medium">Preconditions<textarea name="preconditions" rows={3} defaultValue={testCase.preconditions} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60" /></label>
          <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-medium">Steps — one per line<textarea name="steps" rows={8} defaultValue={steps.join("\n")} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60" /></label><label className="block text-sm font-medium">Expected results — one per line<textarea name="expectedResults" rows={8} defaultValue={expectedResults.join("\n")} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60" /></label></div>
          <div className="grid gap-5 sm:grid-cols-2"><label className="block text-sm font-medium">Type<select name="type" defaultValue={testCase.type} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60"><option value="FUNCTIONAL">Functional</option><option value="END_TO_END">End to end</option><option value="API">API</option><option value="INTEGRATION">Integration</option><option value="REGRESSION">Regression</option></select></label><label className="block text-sm font-medium">Priority<select name="priority" defaultValue={testCase.priority} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60"><option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select></label></div>
          <label className="block text-sm font-medium">Tags<input name="tags" defaultValue={testCase.tags.join(", ")} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60" /></label>
          <button className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Save new version</button>
        </form>
      ) : (
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Objective</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{testCase.objective}</p>
          <h2 className="mt-7 border-t pt-6 text-sm font-semibold uppercase tracking-wide text-slate-400">Preconditions</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">{testCase.preconditions || "None specified."}</p>
          <div className="mt-7 grid gap-6 border-t pt-6 sm:grid-cols-2"><div><h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Steps</h2><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">{steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol></div><div><h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Expected results</h2><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">{expectedResults.map((result, index) => <li key={`${index}-${result}`}>{result}</li>)}</ul></div></div>
        </section>
      )}

      <section className="mt-8 rounded-2xl border border-cyan-200 bg-cyan-50/30 p-6 shadow-sm sm:p-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Automation Studio</p>
          <h2 className="mt-2 text-lg font-semibold">Automate this Test Case</h2>
          <p className="mt-1 text-sm text-slate-600">
            Browser and API engines create separate, reviewable artifacts pinned to this exact approved Test Case version. Generated code is never executed automatically.
          </p>
        </div>
        {automationArtifacts.items.length ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {automationArtifacts.items.map((artifact) => (
              <Link
                key={artifact.id}
                href={`/workspace/${orgSlug}/projects/${projectId}/automation/${artifact.id}`}
                className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-cyan-300"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold">
                    {artifact.engine === "PLAYWRIGHT_BROWSER" ? "Playwright Browser" : "Playwright API"}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">{artifact.status.replace("_", " ")}</span>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Current v{artifact.currentVersionNumber} · Approved v{artifact.approvedVersionNumber ?? "—"}
                </p>
              </Link>
            ))}
          </div>
        ) : null}
        {testCase.status === "APPROVED" && detail.canGenerateAutomation ? (
          <form action={automateAction} className="mt-5 rounded-xl border border-cyan-200 bg-white p-4">
            <label className="block text-sm font-medium">
              Optional generation guidance
              <textarea
                name="guidance"
                rows={3}
                maxLength={10000}
                placeholder="Add known routes, API contracts, test data, fixture conventions, or selector contracts."
                className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60"
              />
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button name="engine" value="PLAYWRIGHT_BROWSER" className="rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white">
                Generate Browser automation
              </button>
              <button name="engine" value="PLAYWRIGHT_API" className="rounded-lg border border-cyan-300 bg-white px-4 py-2.5 text-sm font-semibold text-cyan-800">
                Generate API automation
              </button>
            </div>
          </form>
        ) : testCase.status !== "APPROVED" ? (
          <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Approve the Test Case before generating automation.
          </p>
        ) : null}
      </section>

      <section className="mt-8 rounded-2xl border border-violet-200 bg-violet-50/30 p-6 shadow-sm sm:p-8">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">Traceability</p><h2 className="mt-2 text-lg font-semibold">Linked Requirements</h2><p className="mt-1 text-sm text-slate-600">Shows exactly which approved product intent this test helps verify.</p></div>
        <div className="mt-5 space-y-2">{testCase.requirementLinks.length ? testCase.requirementLinks.map((link) => <div key={link.requirementId} className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4"><Link href={`/workspace/${orgSlug}/projects/${projectId}/requirements/${link.requirement.id}`} className="text-sm font-semibold hover:text-violet-700">{link.requirement.title} <span className="ml-2 text-xs font-normal text-slate-400">v{link.requirement.currentVersionNumber} · {link.requirement.status.replace("_", " ")}</span></Link>{detail.canManageTraceability ? <form action={unlinkAction}><input type="hidden" name="requirementId" value={link.requirementId} /><button className="text-xs font-semibold text-slate-500 hover:text-red-700">Unlink</button></form> : null}</div>) : <p className="rounded-xl border border-dashed border-violet-200 bg-white p-4 text-sm text-slate-500">No Requirement linked yet.</p>}</div>
        {detail.canManageTraceability && availableRequirements.length ? <form action={linkAction} className="mt-4 flex flex-col gap-2 sm:flex-row"><select name="requirementId" required className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="">Select a Requirement</option>{availableRequirements.map((requirement) => <option key={requirement.id} value={requirement.id}>{requirement.title}</option>)}</select><button className="rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white">Link Requirement</button></form> : null}
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-lg font-semibold">Version history</h2><p className="mt-1 text-sm text-slate-500">Historical snapshots are read-only.</p>
        <div className="mt-6 divide-y divide-slate-200 border-y border-slate-200">{testCase.versions.map((version) => <details key={version.id} className="py-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-4"><span className="text-sm font-semibold">Version {version.versionNumber}</span><span className="text-xs text-slate-400">{version.createdBy.displayName || "Workspace member"} · {version.createdAt.toLocaleString()}</span></summary><div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700"><p className="font-semibold text-slate-950">{version.title}</p><p className="mt-2">{version.objective || "No objective."}</p><p className="mt-3 text-xs font-semibold uppercase text-slate-400">{version.type.replaceAll("_", " ")} · {version.priority} · {version.automationStatus}</p></div></details>)}</div>
      </section>
    </div>
  );
}
