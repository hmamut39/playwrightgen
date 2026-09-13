"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";

/**
 * What someone sees if a workspace page fails to load.
 *
 * Without this, a failure showed Next's bare error screen: no product, no way
 * back, and nothing to suggest whether waiting or retrying would help. The
 * commonest cause in practice is timing -- a workspace created seconds ago that
 * the server has not finished setting up -- and retrying fixes it, so that is
 * the first thing offered.
 */
export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  function retry() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-slate-50 px-4 py-16">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-slate-950 text-sm font-bold text-white">
          PG
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">
          This page didn&rsquo;t load
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          If you just created your workspace, it may still be finishing setup.
          Trying again usually works. Nothing you entered has been lost.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <button
            type="button"
            onClick={retry}
            className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Try again
          </button>
          <Link
            href="/workspace"
            className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Go to my workspace
          </Link>
        </div>
        {error.digest ? (
          <p className="mt-6 text-xs text-slate-400">Reference: {error.digest}</p>
        ) : null}
      </div>
    </main>
  );
}
