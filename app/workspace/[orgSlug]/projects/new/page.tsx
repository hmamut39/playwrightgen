import { redirect } from "next/navigation";
import { after } from "next/server";

import { NotAllowed } from "@/components/workspace/not-allowed";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { slugify } from "@/lib/format/slug";
import { PageCoverageError, startPageCoveragePlan } from "@/lib/services/page-coverage";
import { createProject, updateProject } from "@/lib/services/projects";

// Planning the first page finishes after this page has answered.
export const maxDuration = 300;

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

    // With an address, the first project goes straight to its first evidence:
    // the page is read and its tests planned while this form answers, and the
    // person lands on the plan rather than on an empty project.
    const pageUrl = String(formData.get("pageUrl") ?? "").trim();
    if (!pageUrl) redirect(`/workspace/${orgSlug}/projects/${project.id}/overview`);
    await updateProject({ orgSlug, projectId: project.id, liveUrl: pageUrl }).catch((error: unknown) =>
      console.error("[new-project] could not keep the address", error),
    );
    let coverageId: string;
    try {
      const run = await startPageCoveragePlan({ orgSlug, projectId: project.id, pageUrl }, after);
      coverageId = run.id;
    } catch (caught) {
      if (!(caught instanceof PageCoverageError)) console.error("[new-project] planning failed unexpectedly", caught);
      redirect(
        `/workspace/${orgSlug}/projects/${project.id}/cover?error=${caught instanceof PageCoverageError ? caught.code : "plan_failed"}`,
      );
    }
    redirect(`/workspace/${orgSlug}/projects/${project.id}/cover/${coverageId}`);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Projects</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Create project</h1>
      <p className="mt-2 text-sm text-slate-600">
        One project for each product or app you test. Give it a page too and PlaywrightGen plans that page&rsquo;s tests
        straight away. You can change both later.
      </p>
      <form action={createProjectAction} className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <label className="block text-sm font-medium">
          Name
          <input name="name" required maxLength={200} autoFocus placeholder="For example: Checkout web app" className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60" />
        </label>
        <label className="block text-sm font-medium">
          Where does it run? <span className="font-normal text-slate-400">(optional)</span>
          <input
            name="pageUrl"
            type="url"
            maxLength={2_000}
            placeholder="https://your-app.example.com/"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
          />
          <span className="mt-1.5 block text-xs font-normal text-slate-500">
            A public page of your product. PlaywrightGen reads it, plans the tests it needs, and shows you the plan to
            tick &mdash; about a minute. Leave it empty to set it up later.
          </span>
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
