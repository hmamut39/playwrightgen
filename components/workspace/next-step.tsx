import Link from "next/link";

/**
 * The one thing to do next on this record, stated plainly.
 *
 * A requirement page offers a form, an AI review, a coverage panel, version
 * history and two or three buttons, all at once. Someone who knows the product
 * reads that as a toolbox; someone on their first day reads it as a puzzle and
 * stops. This names the next move for the record's current state and the
 * reader's role, and says what it leads to.
 */
export function NextStep({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: { label: string; href: string };
}) {
  return (
    <section
      aria-label="Next step"
      className="mt-6 flex flex-col gap-3 rounded-2xl border border-cyan-200 bg-cyan-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-800">Next step</p>
        <p className="mt-1 text-sm font-semibold text-slate-950">{title}</p>
        <p className="mt-0.5 text-sm leading-6 text-slate-600">{detail}</p>
      </div>
      {action ? (
        <Link
          href={action.href}
          className="shrink-0 rounded-lg bg-slate-950 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-slate-800"
        >
          {action.label}
        </Link>
      ) : null}
    </section>
  );
}
