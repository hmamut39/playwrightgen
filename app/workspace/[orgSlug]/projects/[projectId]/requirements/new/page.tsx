import Link from "next/link";
import { redirect } from "next/navigation";

import { PendingButton } from "@/components/workspace/pending-button";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import {
  draftRequirementFromTicket,
  RequirementDraftingError,
} from "@/lib/services/requirement-drafting";
import { getProject } from "@/lib/services/projects";
import { createRequirement } from "@/lib/services/requirements";

export default async function NewRequirementPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgSlug: string; projectId: string }>;
  searchParams: Promise<{
    title?: string;
    description?: string;
    acceptanceCriteria?: string;
    externalReference?: string;
    assumptions?: string;
    read?: string;
  }>;
}) {
  const { orgSlug, projectId } = await params;
  const filled = await searchParams;
  const assumptions = filled.assumptions ? filled.assumptions.split("\n").filter(Boolean) : [];
  await requireWorkspaceContext({
    orgSlug,
    projectId,
    permission: "requirement:create",
  });
  const project = await getProject({ orgSlug, projectId });

  /**
   * Reads a pasted ticket into the fields below. It fills the form and
   * nothing else: no record exists until the person presses Create draft, and
   * nothing counts until somebody approves it.
   */
  async function readTicketAction(formData: FormData) {
    "use server";
    const here = `/workspace/${orgSlug}/projects/${projectId}/requirements/new`;
    let drafted;
    try {
      drafted = await draftRequirementFromTicket({
        orgSlug,
        projectId,
        ticket: String(formData.get("ticket") ?? ""),
      });
    } catch (error) {
      if (error instanceof RequirementDraftingError) redirect(`${here}?read=${error.code}`);
      throw error;
    }
    const carried = new URLSearchParams({
      read: "ok",
      title: drafted.title,
      description: drafted.description,
      acceptanceCriteria: drafted.acceptanceCriteria,
      externalReference: drafted.externalReference,
      ...(drafted.assumptions.length ? { assumptions: drafted.assumptions.join("\n") } : {}),
    });
    redirect(`${here}?${carried.toString()}`);
  }

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

      <section className="mt-6 rounded-2xl border border-cyan-200 bg-cyan-50/50 p-5 sm:p-6">
        <h2 className="text-sm font-semibold text-slate-900">Start from a ticket</h2>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          Paste a Jira ticket, a Linear issue, a GitHub issue or any description of the work. It fills the fields
          below for you to check and edit. Nothing is created until you press Create draft.
        </p>
        <form action={readTicketAction} className="mt-3">
          <textarea
            name="ticket"
            rows={5}
            required
            minLength={20}
            maxLength={20_000}
            aria-label="Ticket text"
            placeholder="Paste the ticket here, title and body."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-cyan-600 focus-visible:ring-2 focus-visible:ring-cyan-500/60"
          />
          <PendingButton
            pendingLabel="Reading…"
            className="mt-3 rounded-lg bg-cyan-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-800"
          >
            Read the ticket
          </PendingButton>
          <span className="ml-3 text-xs text-slate-500">Uses one of the workspace&rsquo;s daily AI requests.</span>
        </form>

        {filled.read === "not_behaviour" ? (
          <p role="alert" className="mt-3 text-xs font-semibold text-amber-800">
            That ticket does not describe product behaviour a test could verify &mdash; it reads as work like an
            upgrade, a question or a bug report with no expected behaviour. Write the requirement yourself below.
          </p>
        ) : filled.read === "empty_ticket" ? (
          <p role="alert" className="mt-3 text-xs font-semibold text-red-700">There is not enough text to read.</p>
        ) : filled.read === "unavailable" ? (
          <p role="alert" className="mt-3 text-xs font-semibold text-red-700">
            The ticket could not be read just now. The fields below still work.
          </p>
        ) : filled.read === "ok" ? (
          <p role="status" className="mt-3 text-xs font-semibold text-emerald-800">
            Read into the fields below. Check every line before you create it.
          </p>
        ) : null}

        {assumptions.length ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-xs font-semibold text-amber-900">
              The ticket left {assumptions.length === 1 ? "this open" : "these open"} &mdash; settle{" "}
              {assumptions.length === 1 ? "it" : "them"} before anyone approves this:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-amber-900">
              {assumptions.map((assumption) => (
                <li key={assumption}>{assumption}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

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
            defaultValue={filled.title ?? ""}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
          />
        </label>
        <label className="block text-sm font-medium">
          Description
          <textarea
            name="description"
            rows={7}
            maxLength={50000}
            defaultValue={filled.description ?? ""}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
          />
        </label>
        <label className="block text-sm font-medium">
          Acceptance criteria
          <textarea
            name="acceptanceCriteria"
            rows={7}
            maxLength={50000}
            defaultValue={filled.acceptanceCriteria ?? ""}
            placeholder="Describe observable, testable outcomes."
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
          />
        </label>
        <label className="block text-sm font-medium">
          External reference
          <input
            name="externalReference"
            maxLength={500}
            defaultValue={filled.externalReference ?? ""}
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
