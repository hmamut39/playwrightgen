import { redirect } from "next/navigation";

import { NotAllowed } from "@/components/workspace/not-allowed";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { slugify } from "@/lib/format/slug";
import { createProject } from "@/lib/services/projects";

export default async function NewProjectPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const context = await requireWorkspaceContext({ orgSlug });
  if (!context.can("project:create")) {
    return (
      <NotAllowed
        title="Only an owner or admin can create a project"
        detail="Ask a workspace owner or admin to create it, or to change your role. They can add you to an existing project from its Team tab."
        backHref={`/workspace/${orgSlug}`}
        backLabel="Back to projects"
      />
    );
  }

  async function createProjectAction(formData: FormData) {
    "use server";
    const name = String(formData.get("name") ?? "");
    // Derived from the name unless the person chose one. Asking everyone to
    // invent a URL-safe identifier made the first form in the product the one
    // people had to stop and ask about.
    const slug = String(formData.get("slug") ?? "").trim() || slugify(name);
    const project = await createProject({
      orgSlug,
      name,
      slug,
      description: String(formData.get("description") ?? "") || null,
    });
    redirect(`/workspace/${orgSlug}/projects/${project.id}/overview`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Projects</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Create project</h1>
      <p className="mt-2 text-sm text-slate-600">One project for each product or app you test. You can rename it later.</p>
      <form action={createProjectAction} className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <label className="block text-sm font-medium">
          Name
          <input name="name" required maxLength={200} autoFocus placeholder="For example: Checkout web app" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60" />
        </label>
        {/* The address is derived from the name; most people never need to
            see it, so it waits behind a disclosure instead of asking a
            question on the first form they fill in. */}
        <details className="group rounded-lg">
          <summary className="cursor-pointer text-sm font-medium text-slate-600 hover:text-slate-900">
            Custom project address <span className="font-normal text-slate-400">(optional)</span>
          </summary>
        <label className="mt-3 block text-sm font-medium">
          Slug <span className="font-normal text-slate-400">(optional)</span>
          <input name="slug" maxLength={100} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" title="Lowercase letters, numbers and hyphens, for example checkout-flow" placeholder="Leave blank to create it from the name" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60" />
          <span className="mt-1.5 block text-xs font-normal text-slate-500">
            Used in the project&rsquo;s address. Lowercase letters, numbers and hyphens only &mdash; &ldquo;Checkout Flow&rdquo; becomes <code className="font-mono">checkout-flow</code>.
          </span>
        </label>
        </details>
        <label className="block text-sm font-medium">
          Description <span className="font-normal text-slate-400">(optional)</span>
          <textarea name="description" rows={4} maxLength={10000} placeholder="What the product does and who uses it." className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60" />
        </label>
        <button type="submit" className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">Create project</button>
      </form>
    </div>
  );
}
