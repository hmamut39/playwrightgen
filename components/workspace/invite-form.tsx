"use client";

import { useActionState } from "react";

import { PendingButton } from "@/components/workspace/pending-button";

export type InviteState = { status: "idle" | "sent" | "error"; message: string };

export function InviteForm({
  action,
}: {
  action: (state: InviteState, formData: FormData) => Promise<InviteState>;
}) {
  const initialState: InviteState = { status: "idle", message: "" };
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form action={formAction} className="mt-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1 text-sm font-medium text-slate-800">
          Email address
          <input
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="colleague@company.com"
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
          />
        </label>
        <label className="block text-sm font-medium text-slate-800 sm:w-44">
          Role in this project
          <select
            name="role"
            defaultValue="MEMBER"
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
          >
            <option value="MEMBER">Member</option>
            <option value="PROJECT_LEAD">Lead</option>
            <option value="VIEWER">Viewer</option>
          </select>
        </label>
        <PendingButton
          pendingLabel="Sending…"
          className="justify-center rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Send invitation
        </PendingButton>
      </div>
      {state.status !== "idle" ? (
        <p
          role="status"
          className={`mt-3 rounded-lg px-3 py-2 text-sm ${
            state.status === "sent"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-800"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
