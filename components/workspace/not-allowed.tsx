import Link from "next/link";

/**
 * What someone sees on a page their role does not allow.
 *
 * A page that simply demands a permission throws, and the workspace error
 * boundary then says "This page didn't load" — which reads as a fault in the
 * product and tells the person nothing about what to do. This says what the
 * page is for, who can open it, and where to go instead.
 */
export function NotAllowed({
  title,
  detail,
  backHref,
  backLabel = "Back to the workspace",
}: {
  title: string;
  detail: string;
  backHref: string;
  backLabel?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Not allowed</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{detail}</p>
        <Link
          href={backHref}
          className="mt-6 inline-flex rounded-lg bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          {backLabel}
        </Link>
      </section>
    </div>
  );
}
