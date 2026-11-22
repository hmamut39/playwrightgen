"use client";

import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The way into a workspace you belong to but are not currently in.
 *
 * A workspace page resolves from the session's active organization, so
 * following a teammate's link into another workspace answered "That page is
 * not here" about a project you own. The switcher that fixes it sits at the
 * top of the page you could not reach.
 *
 * One press rather than an automatic switch: changing which workspace
 * somebody is in is a side effect, and a product that does it silently will
 * eventually do it at the wrong moment. The sentence says what will happen
 * and the button does exactly that.
 */
export function OpenOtherWorkspace({
  name,
  clerkOrganizationId,
}: {
  name: string;
  clerkOrganizationId: string;
}) {
  const { setActive } = useClerk();
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
        Another workspace
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-slate-950">
        This page is in {name}
      </h1>
      <p className="mt-4 text-base leading-7 text-slate-700">
        You are a member of {name}, but you are currently working in a different
        workspace, so this address does not resolve. Switching takes you
        straight to the page you were trying to open.
      </p>
      {failed ? (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          That did not switch. Use the workspace menu at the top of any
          workspace page to pick {name}, then open this address again.
        </p>
      ) : null}
      <div className="mt-8 flex flex-wrap gap-3 text-sm">
        <button
          type="button"
          disabled={switching}
          onClick={async () => {
            setSwitching(true);
            setFailed(false);
            try {
              await setActive({ organization: clerkOrganizationId });
              router.refresh();
            } catch {
              setFailed(true);
              setSwitching(false);
            }
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {switching ? (
            <span
              aria-hidden
              className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
            />
          ) : null}
          {switching ? `Switching to ${name}…` : `Switch to ${name}`}
        </button>
      </div>
    </main>
  );
}
