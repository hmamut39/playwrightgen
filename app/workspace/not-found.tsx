import Link from "next/link";

/**
 * What a workspace address that does not exist should say.
 *
 * The framework's default is "404 — This page could not be found", on a bare
 * white page with no way back. That is accurate and it leaves the reader
 * stuck: inside a signed-in product, the useful information is not the number
 * but whether they typed something wrong, whether the thing was deleted, and
 * where to go now.
 *
 * It replaced something worse. Until 2026-11-21 a project address that was
 * not a real id answered 500 and said "If you just created your workspace, it
 * may still be finishing setup. Trying again usually works" -- advice that
 * was false in every particular for a stale or mistyped link. The honest
 * version has to be careful not to overcorrect: this page cannot tell a
 * deleted project from a typo, so it says both and claims neither.
 */
export default function WorkspaceNotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
        Nothing at this address
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-slate-950">
        That page is not here
      </h1>
      <p className="mt-4 text-base leading-7 text-slate-700">
        The address does not match anything in this workspace. Either it was
        typed or pasted with something missing, or whatever it pointed at has
        since been archived or deleted. Reloading will not change that, and
        nothing you were working on has been lost.
      </p>
      <p className="mt-3 text-base leading-7 text-slate-700">
        If you followed a link from inside the product and expected it to work,
        that is worth telling me about &mdash; use &ldquo;Something wrong on
        this page?&rdquo; below, and it arrives with the address you were on.
      </p>
      <div className="mt-8 flex flex-wrap gap-3 text-sm">
        <Link
          href="/workspace"
          className="rounded-xl bg-slate-950 px-4 py-2.5 font-semibold text-white hover:bg-slate-800"
        >
          Back to my projects
        </Link>
      </div>
    </main>
  );
}
