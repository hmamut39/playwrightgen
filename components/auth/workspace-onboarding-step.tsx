"use client";

import { useOrganizationList, useUser } from "@clerk/nextjs";
import { useState } from "react";

import { slugify } from "@/lib/format/slug";

/**
 * The first thing a new account sees: name your workspace.
 *
 * Clerk's built-in step asked a person who had just signed up to "Setup your
 * organization", pre-filled the name with a guess from their email domain -- a
 * test address produced "Internet Assigned Numbers Authority (IANA)" -- and
 * showed a slug field ending in a long number. Three unfamiliar words on the
 * very first screen, one of them wrong. This asks one question in the product's
 * own language, and handles the two other ways someone arrives: invited to a
 * team, or already a member of one.
 */

function randomSuffix() {
  return Math.random().toString(36).slice(2, 6);
}

function isSlugTaken(error: unknown) {
  const errors = (error as { errors?: Array<{ code?: string }> })?.errors ?? [];
  return errors.some((entry) => /slug|form_identifier_exists|already/i.test(entry.code ?? ""));
}

export function WorkspaceOnboardingStep({ returnUrl = "/workspace" }: { returnUrl?: string }) {
  const { user } = useUser();
  const { isLoaded, createOrganization, setActive, userMemberships, userInvitations } =
    useOrganizationList({ userMemberships: true, userInvitations: true });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const suggested = user?.firstName ? `${user.firstName}'s team` : "";

  async function open(organizationId: string) {
    await setActive?.({ organization: organizationId });
    // A full load, not a client navigation: the server has to see the session
    // with its new active workspace, and Clerk's own redirect from a pending
    // session sent people back to this page.
    window.location.assign(returnUrl);
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const workspaceName = (name || suggested).trim();
    if (!workspaceName || !createOrganization) {
      setError("Give your workspace a name.");
      return;
    }
    setBusy("create");
    setError("");
    const base = slugify(workspaceName, "workspace").slice(0, 40);
    try {
      let organization;
      try {
        organization = await createOrganization({ name: workspaceName, slug: base });
      } catch (caught) {
        if (!isSlugTaken(caught)) throw caught;
        // Someone else already uses that address; keep the name, vary the address.
        organization = await createOrganization({
          name: workspaceName,
          slug: `${base}-${randomSuffix()}`,
        });
      }
      await open(organization.id);
    } catch {
      setError("The workspace could not be created. Please try again.");
      setBusy(null);
    }
  }

  if (!isLoaded) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-3xl bg-white p-8 text-sm text-slate-500">
        <span className="mr-3 h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
        Loading…
      </div>
    );
  }

  const memberships = userMemberships.data ?? [];
  const invitations = (userInvitations.data ?? []).filter((invitation) => invitation.status === "pending");

  return (
    <div className="rounded-3xl bg-white p-6 text-slate-950 shadow-2xl sm:p-8">
      {invitations.length > 0 ? (
        <section className="mb-7">
          <h2 className="text-lg font-semibold">You&rsquo;ve been invited</h2>
          <ul className="mt-3 space-y-2">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3"
              >
                <span className="min-w-0 truncate text-sm font-medium">
                  {invitation.publicOrganizationData.name}
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(invitation.id);
                    setError("");
                    try {
                      await invitation.accept();
                      await open(invitation.publicOrganizationData.id);
                    } catch {
                      setError("That invitation could not be accepted. Ask for a new one.");
                      setBusy(null);
                    }
                  }}
                  className="shrink-0 rounded-lg bg-slate-950 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {busy === invitation.id ? "Joining…" : "Join"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {memberships.length > 0 ? (
        <section className="mb-7">
          <h2 className="text-lg font-semibold">Your workspaces</h2>
          <ul className="mt-3 space-y-2">
            {memberships.map((membership) => (
              <li key={membership.id}>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(membership.organization.id);
                    await open(membership.organization.id);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-left text-sm font-medium transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
                >
                  <span className="min-w-0 truncate">{membership.organization.name}</span>
                  <span className="shrink-0 text-slate-500">
                    {busy === membership.organization.id ? "Opening…" : "Open →"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <form onSubmit={create}>
        <h2 className="text-lg font-semibold">
          {memberships.length || invitations.length ? "Or start a new workspace" : "Name your workspace"}
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">
          A workspace holds your projects and your team. Most people use their
          company or team name. You can change it later.
        </p>
        <label className="mt-5 block text-sm font-medium" htmlFor="workspace-name">
          Workspace name
        </label>
        <input
          id="workspace-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={suggested || "Acme QA team"}
          maxLength={100}
          autoFocus
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/60"
        />
        {error ? (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy !== null}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {busy === "create" ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Creating your workspace…
            </>
          ) : (
            "Create workspace"
          )}
        </button>
      </form>
    </div>
  );
}
