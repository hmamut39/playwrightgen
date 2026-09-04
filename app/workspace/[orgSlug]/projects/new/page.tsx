import { redirect } from "next/navigation";

import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { createProject } from "@/lib/services/projects";

export default async function NewProjectPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  await requireWorkspaceContext({ orgSlug, permission: "project:create" });

  async function createProjectAction(formData: FormData) {
    "use server";
    const project = await createProject({
      orgSlug,
      name: String(formData.get("name") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      description: String(formData.get("description") ?? "") || null,
    });
    redirect(`/workspace/${orgSlug}/projects/${project.id}/overview`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Projects</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Create project</h1>
      <p className="mt-2 text-sm text-slate-600">Set the durable identity for this quality workspace project.</p>
      <form action={createProjectAction} className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <label className="block text-sm font-medium">
          Name
          <input name="name" required maxLength={200} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60" />
        </label>
        <label className="block text-sm font-medium">
          Slug
          <input name="slug" required maxLength={100} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="release-confidence" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60" />
        </label>
        <label className="block text-sm font-medium">
          Description
          <textarea name="description" rows={5} maxLength={10000} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60" />
        </label>
        <button type="submit" className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">Create project</button>
      </form>
    </div>
  );
}
