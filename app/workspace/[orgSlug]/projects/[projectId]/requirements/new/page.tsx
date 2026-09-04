import Link from "next/link";
import { redirect } from "next/navigation";

import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { getProject } from "@/lib/services/projects";
import { createRequirement } from "@/lib/services/requirements";

export default async function NewRequirementPage({
  params,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
}) {
  const { orgSlug, projectId } = await params;
  await requireWorkspaceContext({
    orgSlug,
    projectId,
    permission: "requirement:create",
  });
  const project = await getProject({ orgSlug, projectId });

  async function createRequirementAction(formData: FormData) {
    "use server";
    const requirement = await createRequirement({
      orgSlug,
      projectId,
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      acceptanceCriteria: String(formData.get("acceptanceCriteria") ?? ""),
      source: "MANUAL",
      externalReference: String(formData.get("externalReference") ?? "") || null,
    });
    redirect(
      `/workspace/${orgSlug}/projects/${projectId}/requirements/${requirement.id}`,
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href={`/workspace/${orgSlug}/projects/${projectId}/requirements`}
        className="text-sm font-medium text-sky-700 hover:text-sky-900"
      >
        ← Requirements
      </Link>
      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
        {project.name}
      </p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">New requirement</h1>
      <p className="mt-2 text-sm text-slate-600">
        Start a draft. Description and acceptance criteria are required before review.
      </p>

      <form
        action={createRequirementAction}
        className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <label className="block text-sm font-medium">
          Title
          <input
            name="title"
            required
            maxLength={300}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
          />
        </label>
        <label className="block text-sm font-medium">
          Description
          <textarea
            name="description"
            rows={7}
            maxLength={50000}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
          />
        </label>
        <label className="block text-sm font-medium">
          Acceptance criteria
          <textarea
            name="acceptanceCriteria"
            rows={7}
            maxLength={50000}
            placeholder="Describe observable, testable outcomes."
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
          />
        </label>
        <label className="block text-sm font-medium">
          External reference
          <input
            name="externalReference"
            maxLength={500}
            placeholder="e.g. JIRA-123 or a source URL"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Create draft
        </button>
      </form>
    </div>
  );
}
