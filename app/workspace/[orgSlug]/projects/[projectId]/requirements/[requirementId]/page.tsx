import { revalidatePath } from "next/cache";
import Link from "next/link";

import {
  listRequirementReviews,
  resolveAiSuggestion,
  runRequirementReview,
} from "@/lib/services/requirement-reviews";
import {
  approveRequirement,
  archiveRequirement,
  getRequirementDetail,
  requestRequirementChanges,
  submitRequirementForReview,
  updateRequirementDraft,
} from "@/lib/services/requirements";

const statusStyle = {
  DRAFT: "bg-slate-100 text-slate-700",
  IN_REVIEW: "bg-amber-50 text-amber-800",
  APPROVED: "bg-emerald-50 text-emerald-700",
  ARCHIVED: "bg-slate-100 text-slate-500",
} as const;

export default async function RequirementDetailPage({
  params,
}: {
  params: Promise<{
    orgSlug: string;
    projectId: string;
    requirementId: string;
  }>;
}) {
  const { orgSlug, projectId, requirementId } = await params;
  const [detail, reviews] = await Promise.all([
    getRequirementDetail({
      orgSlug,
      projectId,
      requirementId,
      allowArchived: true,
    }),
    listRequirementReviews({ orgSlug, projectId, requirementId }),
  ]);
  const { requirement } = detail;
  const requirementPath = `/workspace/${orgSlug}/projects/${projectId}/requirements/${requirementId}`;
  const listPath = `/workspace/${orgSlug}/projects/${projectId}/requirements`;
  const isReviewComplete = Boolean(
    requirement.description.trim() && requirement.acceptanceCriteria.trim(),
  );

  async function updateDraftAction(formData: FormData) {
    "use server";
    await updateRequirementDraft({
      orgSlug,
      projectId,
      requirementId,
      expectedVersion: Number(formData.get("expectedVersion")),
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      acceptanceCriteria: String(formData.get("acceptanceCriteria") ?? ""),
      source: requirement.source,
      externalReference: String(formData.get("externalReference") ?? "") || null,
    });
    revalidatePath(requirementPath);
    revalidatePath(listPath);
  }

  async function transitionAction(formData: FormData) {
    "use server";
    const input = { orgSlug, projectId, requirementId };
    const intent = formData.get("intent");
    if (intent === "submit") {
      await submitRequirementForReview(input);
    } else if (intent === "approve") {
      await approveRequirement(input);
    } else if (intent === "request-changes") {
      await requestRequirementChanges(input);
    } else if (intent === "archive") {
      await archiveRequirement(input);
    } else {
      throw new Error("Invalid requirement transition intent");
    }
    revalidatePath(requirementPath);
    revalidatePath(listPath);
  }

  async function runReviewAction() {
    "use server";
    await runRequirementReview({ orgSlug, projectId, requirementId });
    revalidatePath(requirementPath);
  }

  async function resolveSuggestionAction(formData: FormData) {
    "use server";
    const resolution = formData.get("resolution");
    if (resolution !== "ACCEPTED" && resolution !== "DISMISSED") {
      throw new Error("Invalid suggestion resolution");
    }
    await resolveAiSuggestion({
      orgSlug,
      projectId,
      requirementId,
      suggestionId: String(formData.get("suggestionId") ?? ""),
      resolution,
    });
    revalidatePath(requirementPath);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={listPath}
        className="text-sm font-medium text-sky-700 hover:text-sky-900"
      >
        ← Requirements
      </Link>

      <header className="mt-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle[requirement.status]}`}
            >
              {requirement.status.replace("_", " ")}
            </span>
            <span className="text-xs text-slate-400">
              Version {requirement.currentVersionNumber}
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {requirement.title}
          </h1>
          <p className="mt-3 text-sm text-slate-500">
            Owned by {requirement.owner.displayName || "Workspace member"} · Created by{" "}
            {requirement.createdBy.displayName || "Workspace member"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {requirement.status === "DRAFT" && detail.canSubmit && isReviewComplete ? (
            <form action={transitionAction}>
              <input type="hidden" name="intent" value="submit" />
              <button className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
                Submit for review
              </button>
            </form>
          ) : null}
          {requirement.status === "IN_REVIEW" && detail.canApprove ? (
            <>
              <form action={transitionAction}>
                <input type="hidden" name="intent" value="request-changes" />
                <button className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">
                  Request changes
                </button>
              </form>
              <form action={transitionAction}>
                <input type="hidden" name="intent" value="approve" />
                <button className="rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">
                  Approve
                </button>
              </form>
            </>
          ) : null}
          {requirement.status !== "ARCHIVED" && detail.canArchive ? (
            <form action={transitionAction}>
              <input type="hidden" name="intent" value="archive" />
              <button className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50">
                Archive
              </button>
            </form>
          ) : null}
        </div>
      </header>

      {requirement.status === "DRAFT" && detail.canSubmit && !isReviewComplete ? (
        <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Add both a description and acceptance criteria before submitting for review.
        </p>
      ) : null}

      {requirement.status === "DRAFT" && detail.canUpdate ? (
        <form
          action={updateDraftAction}
          className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
        >
          <div>
            <h2 className="text-lg font-semibold">Draft content</h2>
            <p className="mt-1 text-sm text-slate-500">
              Saving a material change creates a new immutable version.
            </p>
          </div>
          <input
            type="hidden"
            name="expectedVersion"
            value={requirement.currentVersionNumber}
          />
          <label className="block text-sm font-medium">
            Title
            <input
              name="title"
              required
              maxLength={300}
              defaultValue={requirement.title}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
            />
          </label>
          <label className="block text-sm font-medium">
            Description
            <textarea
              name="description"
              rows={7}
              maxLength={50000}
              defaultValue={requirement.description}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
            />
          </label>
          <label className="block text-sm font-medium">
            Acceptance criteria
            <textarea
              name="acceptanceCriteria"
              rows={7}
              maxLength={50000}
              defaultValue={requirement.acceptanceCriteria}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
            />
          </label>
          <label className="block text-sm font-medium">
            External reference
            <input
              name="externalReference"
              maxLength={500}
              defaultValue={requirement.externalReference ?? ""}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
            />
          </label>
          <button className="rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
            Save new version
          </button>
        </form>
      ) : (
        <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Description
          </h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
            {requirement.description || "No description provided."}
          </p>
          <h2 className="mt-8 border-t border-slate-200 pt-6 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Acceptance criteria
          </h2>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-700">
            {requirement.acceptanceCriteria || "No acceptance criteria provided."}
          </p>
        </section>
      )}

      <section className="mt-8 rounded-2xl border border-sky-200 bg-sky-50/40 p-6 shadow-sm sm:p-8">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
              Advisory analysis
            </p>
            <h2 className="mt-2 text-lg font-semibold">AI Requirement Review</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Reviews one immutable version for ambiguity, testability, missing criteria,
              conflicts, edge cases, and unanswered questions. Suggestions never edit or
              approve the requirement.
            </p>
          </div>
          {detail.canUpdate && requirement.status !== "ARCHIVED" ? (
            <form action={runReviewAction}>
              <button className="rounded-lg bg-sky-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-900">
                Run AI review
              </button>
            </form>
          ) : null}
        </div>

        {reviews.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-sky-200 bg-white px-4 py-5 text-sm text-slate-500">
            No AI review has been run for this requirement.
          </p>
        ) : (
          <div className="mt-6 space-y-5">
            {reviews.map((review) => (
              <article key={review.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">
                      Version {requirement.versions.find((version) => version.id === review.requirementVersionId)?.versionNumber ?? "?"}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {review.model} · {review.createdBy.displayName || "Workspace member"} ·{" "}
                      {review.startedAt.toLocaleString()}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                    {review.status}
                  </span>
                </div>
                {review.summary ? (
                  <p className="mt-4 text-sm leading-6 text-slate-700">{review.summary}</p>
                ) : null}
                <div className="mt-4 space-y-3">
                  {review.suggestions.map((suggestion) => (
                    <div key={suggestion.id} className="rounded-lg border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                            {suggestion.category.replaceAll("_", " ")} · {suggestion.severity}
                          </p>
                          <h3 className="mt-1 text-sm font-semibold">{suggestion.title}</h3>
                        </div>
                        <span className="text-xs font-medium text-slate-400">{suggestion.status}</span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-700">{suggestion.observation}</p>
                      <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                        <span className="font-semibold">Evidence · {suggestion.evidenceField.replaceAll("_", " ")}: </span>
                        {suggestion.evidenceQuote || "The referenced information is missing."}
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-700">
                        <span className="font-semibold">Recommendation: </span>
                        {suggestion.recommendation}
                      </p>
                      {suggestion.status === "OPEN" && detail.canUpdate ? (
                        <div className="mt-4 flex gap-2">
                          {(["ACCEPTED", "DISMISSED"] as const).map((resolution) => (
                            <form key={resolution} action={resolveSuggestionAction}>
                              <input type="hidden" name="suggestionId" value={suggestion.id} />
                              <input type="hidden" name="resolution" value={resolution} />
                              <button className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">
                                {resolution === "ACCEPTED" ? "Accept suggestion" : "Dismiss"}
                              </button>
                            </form>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-lg font-semibold">Version history</h2>
            <p className="mt-1 text-sm text-slate-500">
              Historical snapshots are read-only.
            </p>
          </div>
          <p className="text-xs text-slate-400">
            Updated {requirement.updatedAt.toLocaleString()}
          </p>
        </div>
        <div className="mt-6 divide-y divide-slate-200 border-y border-slate-200">
          {requirement.versions.map((version) => (
            <details key={version.id} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                <span className="text-sm font-semibold">Version {version.versionNumber}</span>
                <span className="text-xs text-slate-400">
                  {version.createdBy.displayName || "Workspace member"} ·{" "}
                  {version.createdAt.toLocaleString()}
                </span>
              </summary>
              <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-950">{version.title}</p>
                <p className="mt-3 whitespace-pre-wrap leading-6">
                  {version.description || "No description."}
                </p>
                <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Acceptance criteria
                </p>
                <p className="mt-2 whitespace-pre-wrap leading-6">
                  {version.acceptanceCriteria || "No acceptance criteria."}
                </p>
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
