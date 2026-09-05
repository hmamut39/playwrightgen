import Link from "next/link";
import { redirect } from "next/navigation";

import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { getProject } from "@/lib/services/projects";
import { MAX_PAGE_SIZE } from "@/lib/services/list-query";
import { listRequirements } from "@/lib/services/requirements";
import { createTestCase } from "@/lib/services/test-cases";

function lines(value: FormDataEntryValue | null): string[] {
  return String(value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export default async function NewTestCasePage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  await requireWorkspaceContext({ orgSlug, projectId, permission: "testcase:create" });
  const [project, requirements] = await Promise.all([
    getProject({ orgSlug, projectId }),
    listRequirements({ orgSlug, projectId, pageSize: MAX_PAGE_SIZE }),
  ]);

  async function createAction(formData: FormData) {
    "use server";
    const testCase = await createTestCase({
      orgSlug,
      projectId,
      title: String(formData.get("title") ?? ""),
      objective: String(formData.get("objective") ?? ""),
      preconditions: String(formData.get("preconditions") ?? ""),
      steps: lines(formData.get("steps")),
      expectedResults: lines(formData.get("expectedResults")),
      priority: String(formData.get("priority") ?? "MEDIUM") as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
      type: String(formData.get("type") ?? "FUNCTIONAL") as "FUNCTIONAL" | "END_TO_END" | "API" | "INTEGRATION" | "REGRESSION",
      tags: String(formData.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean),
      requirementIds: formData.getAll("requirementIds").map(String),
    });
    redirect(`/workspace/${orgSlug}/projects/${projectId}/test-cases/${testCase.id}`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/workspace/${orgSlug}/projects/${projectId}/test-cases`} className="text-sm font-medium text-violet-700 hover:text-violet-900">
        ← Test Cases
      </Link>
      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">{project.name}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">New test case</h1>
      <p className="mt-2 text-sm text-slate-600">
        Start a draft. Objective, steps, and expected results are required before review.
      </p>

      <form action={createAction} className="mt-8 space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <label className="block text-sm font-medium">Title
          <input name="title" required maxLength={300} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60" />
        </label>
        <label className="block text-sm font-medium">Objective
          <textarea name="objective" rows={4} placeholder="What behavior should this test prove?" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60" />
        </label>
        <label className="block text-sm font-medium">Preconditions
          <textarea name="preconditions" rows={3} placeholder="Required state, data, or permissions." className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60" />
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium">Steps — one per line
            <textarea name="steps" rows={8} placeholder={"Open the sign-in page\nEnter valid credentials\nSubmit the form"} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60" />
          </label>
          <label className="block text-sm font-medium">Expected results — one per line
            <textarea name="expectedResults" rows={8} placeholder={"Workspace opens\nUser identity is visible"} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60" />
          </label>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium">Type
            <select name="type" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60">
              <option value="FUNCTIONAL">Functional</option><option value="END_TO_END">End to end</option>
              <option value="API">API</option><option value="INTEGRATION">Integration</option><option value="REGRESSION">Regression</option>
            </select>
          </label>
          <label className="block text-sm font-medium">Priority
            <select name="priority" defaultValue="MEDIUM" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60">
              <option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option>
            </select>
          </label>
        </div>
        <label className="block text-sm font-medium">Tags
          <input name="tags" placeholder="smoke, checkout, release" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-violet-500 focus-visible:ring-2 focus-visible:ring-violet-500/60" />
        </label>
        {requirements.items.length ? (
          <fieldset>
            <legend className="text-sm font-medium">Requirement traceability</legend>
            <p className="mt-1 text-xs text-slate-500">Optionally link the test to the product intent it verifies.</p>
            <div className="mt-3 max-h-48 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-4">
              {requirements.items.map((requirement) => (
                <label key={requirement.id} className="flex items-start gap-3 text-sm">
                  <input type="checkbox" name="requirementIds" value={requirement.id} className="mt-1" />
                  <span>{requirement.title} <span className="text-xs text-slate-400">· {requirement.status.replace("_", " ")}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <button className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">Create draft</button>
      </form>
    </div>
  );
}
