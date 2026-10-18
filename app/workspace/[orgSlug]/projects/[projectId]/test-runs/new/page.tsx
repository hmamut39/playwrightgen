import Link from "next/link";
import { redirect } from "next/navigation";

import { SearchablePicker, type PickerOption } from "@/components/workspace/searchable-picker";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { getProject } from "@/lib/services/projects";
import { PICKER_PAGE_SIZE } from "@/lib/services/list-query";
import { getTestCaseDetail, listTestCases } from "@/lib/services/test-cases";
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
  // Approved only, decided in the query. Reading a page and then keeping
  // the approved ones is not a filter: a project whose hundred most recently
  // changed test cases are all drafts offered nothing to run, while approved
  // ones sat just past the cap with nothing saying they were there.
  const [project, approved] = await Promise.all([
    getProject({ orgSlug, projectId }),
    listTestCases({ orgSlug, projectId, statuses: ["APPROVED"], pageSize: PICKER_PAGE_SIZE }),
  ]);

  const asOption = (testCase: (typeof approved.items)[number]): PickerOption => ({
    id: testCase.id,
    label: testCase.title,
    hint: `v${testCase.currentVersionNumber}`,
  });

  // Arriving from a Test Case says which one this run is for, and a sample of
  // twenty-five is no place to look for it: the page would quietly open with
  // nothing selected, on a page reached from that very test. So it is read
  // directly and pinned into the options, whether or not the sample holds it.
  const preferred = preferredTestCaseId
    ? await getTestCaseDetail({ orgSlug, projectId, testCaseId: preferredTestCaseId }).catch(
        () => null,
      )
    : null;
  const preferredApproved = preferred?.testCase.status === "APPROVED" ? preferred.testCase : null;
  const options = [
    ...(preferredApproved
      ? [
          {
            id: preferredApproved.id,
            label: preferredApproved.title,
            hint: `v${preferredApproved.currentVersionNumber}`,
          },
        ]
      : []),
    ...approved.items.filter((item) => item.id !== preferredApproved?.id).map(asOption),
  ];

  async function searchTestCases(query: string): Promise<PickerOption[]> {
    "use server";
    // Scoped by the project this page is for, and behind the same read
    // permission as the listing above.
    const found = await listTestCases({
      orgSlug,
      projectId,
      statuses: ["APPROVED"],
      search: query,
      pageSize: PICKER_PAGE_SIZE,
    });
    return found.items.map((testCase) => ({
      id: testCase.id,
      label: testCase.title,
      hint: `v${testCase.currentVersionNumber}`,
    }));
  }

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
      <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em]">New test run</h1>
      <p className="mt-2 text-sm text-slate-600">Record a test you ran yourself, outside CI. The result is saved against the test case exactly as it was approved, so later edits never change what this run proved.</p>

      {approved.total === 0 ? (
        <section className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="font-semibold text-amber-950">An approved Test Case is required</h2>
          <p className="mt-2 text-sm text-amber-900">Create and approve a Test Case before recording execution evidence.</p>
          <Link href={`/workspace/${orgSlug}/projects/${projectId}/test-cases`} className="mt-4 inline-block text-sm font-semibold text-amber-950 underline">Open Test Cases</Link>
        </section>
      ) : (
        <form action={createAction} className="mt-8 space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {preferred && !preferredApproved ? (
            <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              <span className="font-semibold">{preferred.testCase.title}</span> is
              {" "}
              {preferred.testCase.status.replace("_", " ").toLowerCase()}, not approved, so a
              run cannot be recorded against it. Approve it first, or choose another
              test below.
            </p>
          ) : null}
          <div className="block text-sm font-medium">
            Approved Test Case
            <div className="mt-2 font-normal">
              <SearchablePicker
                name="testCaseId"
                options={options}
                total={approved.total}
                search={searchTestCases}
                placeholder="Search approved test cases"
                emptyLabel="No approved test case yet."
                defaultSelectedId={preferredApproved?.id}
              />
            </div>
          </div>
          <label className="block text-sm font-medium">Run name
            <input name="name" required maxLength={300} placeholder="For example: Release 2.3 check on staging" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60" />
          </label>
          <div className="grid gap-5 sm:grid-cols-3">
            <label className="block text-sm font-medium">Mode<select name="mode" defaultValue="MANUAL" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60"><option value="MANUAL">Manual</option><option value="PLAYWRIGHT_BROWSER">Playwright Browser</option><option value="API">API</option></select></label>
            <label className="block text-sm font-medium">Environment<select name="environment" defaultValue="DEVELOPMENT" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60"><option value="LOCAL">Local machine</option><option value="DEVELOPMENT">Development</option><option value="STAGING">Staging</option><option value="PRODUCTION">Production</option><option value="OTHER">Other</option></select></label>
            <label className="block text-sm font-medium">Browser<select name="browser" defaultValue="CHROMIUM" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60"><option value="CHROMIUM">Chrome / Edge (Chromium)</option><option value="FIREFOX">Firefox</option><option value="WEBKIT">Safari (WebKit)</option><option value="NONE">No browser</option></select></label>
          </div>
          <p className="text-xs text-slate-500">Use &ldquo;Manual&rdquo; for a test you clicked through yourself. API tests do not use a browser, so the browser choice is ignored for them.</p>
          <label className="block text-sm font-medium">Address you tested <span className="font-normal text-slate-400">(optional)</span>
            <input name="baseUrl" type="url" placeholder="https://staging.example.com" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none transition focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60" />
          </label>
          <button className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Create run</button>
        </form>
      )}
    </div>
  );
}
