"use client";

import { useFormStatus } from "react-dom";

import { createProjectLabel } from "@/lib/workspace/create-project-label";

/**
 * The Create project button, which has to say that it is working.
 *
 * Its own form can run for a minute: given a page address, creating a project
 * reads that page and plans its tests before redirecting. The reasoning, and
 * what it says while waiting, live in `createProjectLabel`.
 *
 * Disabled while pending, which is half the point: the button was live
 * throughout, so an impatient second click submitted the form again -- a
 * second project and a second planning run out of the same daily allowance.
 */
export function CreateProjectButton() {
  const { pending, data } = useFormStatus();
  const { label, hint } = createProjectLabel({
    pending,
    pageUrl: typeof data?.get("pageUrl") === "string" ? (data.get("pageUrl") as string) : null,
  });

  return (
    <div className="flex flex-col gap-2">
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="inline-flex items-center justify-center gap-2 self-start rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? (
          <span
            aria-hidden
            className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
          />
        ) : null}
        {label}
      </button>
      {hint ? (
        <p role="status" className="text-xs leading-5 text-slate-600">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
