import Link from "next/link";
import { redirect } from "next/navigation";

import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { getProject } from "@/lib/services/projects";
import { MAX_PAGE_SIZE } from "@/lib/services/list-query";
import { listTestCases } from "@/lib/services/test-cases";
import { createTestRun } from "@/lib/services/test-runs";

export default async function NewTestRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
  searchParams: Promise<{ testCaseId?: string }>;
}) {
  const { orgSlug, projectId } = await params;
  const { testCaseId: preferredTestCaseId } = await searchParams;
  await requireWorkspaceContext({ orgSlug, projectId, permission: "testrun:create" });
  const [project, testCases] = await Promise.all([
    getProject({ orgSlug, projectId }),
    listTestCases({ orgSlug, projectId, pageSize: MAX_PAGE_SIZE }),
  ]);
  const approved = testCases.items.filter((testCase) => testCase.status === "APPROVED");

  async function createAction(formData: FormData) {
    "use server";
    const mode = String(formData.get("mode") ?? "MANUAL") as "MANUAL" | "PLAYWRIGHT_BROWSER" | "API";
    const run = await createTestRun({
      orgSlug, projectId,
      testCaseId: String(formData.get("testCaseId") ?? ""),
      name: String(formData.get("name") ?? ""),
      mode,
      environment: String(formData.get("environment") ?? "DEVELOPMENT") as "LOCAL" | "DEVELOPMENT" | "STAGING" | "PRODUCTION" | "OTHER",
      browser: (mode === "API" ? "NONE" : String(formData.get("browser") ?? "CHROMIUM")) as "NONE" | "CHROMIUM" | "FIREFOX" | "WEBKIT",
      baseUrl: String(formData.get("baseUrl") ?? "") || null,
    });
    redirect(`/workspace/${orgSlug}/projects/${projectId}/test-runs/${run.id}`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/workspace/${orgSlug}/projects/${projectId}/test-runs`} className="text-sm font-medium text-cyan-700 hover:text-cyan-900">← Test Runs</Link>
      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">{project.name}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">New test run</h1>
      <p className="mt-2 text-sm text-slate-600">The run permanently pins the currently approved Test Case version.</p>

      {approved.length === 0 ? (
        <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="font-semibold text-amber-950">An approved Test Case is required</h2>
          <p className="mt-2 text-sm text-amber-900">Create and approve a Test Case before recording execution evidence.</p>
          <Link href={`/workspace/${orgSlug}/projects/${projectId}/test-cases`} className="mt-4 inline-block text-sm font-semibold text-amber-950 underline">Open Test Cases</Link>
        </section>
      ) : (
        <form action={createAction} className="mt-8 space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <label className="block text-sm font-medium">Approved Test Case
            <select name="testCaseId" required defaultValue={approved.some((item) => item.id === preferredTestCaseId) ? preferredTestCaseId : ""} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60">
              <option value="">Select a Test Case</option>
              {approved.map((testCase) => <option key={testCase.id} value={testCase.id}>{testCase.title} · v{testCase.currentVersionNumber}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">Run name
            <input name="name" required maxLength={300} placeholder="Staging release regression" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60" />
          </label>
          <div className="grid gap-5 sm:grid-cols-3">
            <label className="block text-sm font-medium">Mode<select name="mode" defaultValue="MANUAL" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60"><option value="MANUAL">Manual</option><option value="PLAYWRIGHT_BROWSER">Playwright Browser</option><option value="API">API</option></select></label>
            <label className="block text-sm font-medium">Environment<select name="environment" defaultValue="DEVELOPMENT" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60"><option>LOCAL</option><option>DEVELOPMENT</option><option>STAGING</option><option>PRODUCTION</option><option>OTHER</option></select></label>
            <label className="block text-sm font-medium">Browser<select name="browser" defaultValue="CHROMIUM" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60"><option>CHROMIUM</option><option>FIREFOX</option><option>WEBKIT</option><option>NONE</option></select></label>
          </div>
          <p className="text-xs text-slate-500">API mode automatically stores browser as NONE. Playwright Browser mode requires a browser.</p>
          <label className="block text-sm font-medium">Base URL
            <input name="baseUrl" type="url" placeholder="https://staging.example.com" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60" />
          </label>
          <button className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Create run</button>
        </form>
      )}
    </div>
  );
}
