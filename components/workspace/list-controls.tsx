import Link from "next/link";

/**
 * Search and paging controls shared by the workspace list surfaces.
 *
 * Deliberately a form and links rather than client-side state. These pages are
 * server rendered, so a plain GET keeps the current view in the URL: it can be
 * bookmarked, shared with a colleague, and reloaded after an action without
 * losing the reader's place. Client state would lose all three for no gain.
 */

export type ListMeta = {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  search: string;
};

function pageHref(basePath: string, search: string, page: number) {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function ListSearch({
  basePath,
  meta,
  placeholder,
}: {
  basePath: string;
  meta: ListMeta;
  placeholder: string;
}) {
  return (
    <form action={basePath} method="get" className="flex w-full gap-2 sm:w-auto">
      <input
        type="search"
        name="q"
        defaultValue={meta.search}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus-visible:ring-2 focus-visible:ring-cyan-500/60 sm:w-72"
      />
      <button
        type="submit"
        className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-cyan-500/60"
      >
        Search
      </button>
      {meta.search ? (
        <Link
          href={basePath}
          className="shrink-0 self-center px-2 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          Clear
        </Link>
      ) : null}
    </form>
  );
}

export function ListPagination({
  basePath,
  meta,
  noun,
}: {
  basePath: string;
  meta: ListMeta;
  noun: string;
}) {
  if (meta.total === 0) return null;

  const first = (meta.page - 1) * meta.pageSize + 1;
  const last = Math.min(meta.total, meta.page * meta.pageSize);
  const hasPrevious = meta.page > 1;
  const hasNext = meta.page < meta.pageCount;

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      {/* The total is itself useful: "12 of 340 requirements" tells a reviewer
          something a scrollbar never does. */}
      <p className="text-xs text-slate-500">
        Showing {first}–{last} of {meta.total} {noun}
        {meta.search ? ` matching “${meta.search}”` : ""}
      </p>
      {meta.pageCount > 1 ? (
        <div className="flex items-center gap-2">
          {hasPrevious ? (
            <Link
              href={pageHref(basePath, meta.search, meta.page - 1)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Previous
            </Link>
          ) : (
            <span className="rounded-xl border border-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-300">
              Previous
            </span>
          )}
          <span className="text-xs text-slate-500">
            Page {meta.page} of {meta.pageCount}
          </span>
          {hasNext ? (
            <Link
              href={pageHref(basePath, meta.search, meta.page + 1)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
            >
              Next
            </Link>
          ) : (
            <span className="rounded-xl border border-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-300">
              Next
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Distinguishes "nothing here yet" from "nothing matched", because they call for
 * different actions and conflating them makes a working filter look broken.
 */
export function ListEmptyState({
  meta,
  emptyTitle,
  emptyDescription,
  basePath,
}: {
  meta: ListMeta;
  emptyTitle: string;
  emptyDescription: string;
  basePath: string;
}) {
  if (meta.search) {
    return (
      <section className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <h2 className="text-lg font-semibold text-slate-900">No matches</h2>
        <p className="mt-2 text-sm text-slate-500">
          Nothing matches “{meta.search}”.
        </p>
        <Link
          href={basePath}
          className="mt-4 inline-flex text-sm font-semibold text-cyan-700 hover:text-cyan-800"
        >
          Clear the search
        </Link>
      </section>
    );
  }

  return (
    <section className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <h2 className="text-lg font-semibold text-slate-900">{emptyTitle}</h2>
      <p className="mt-2 text-sm text-slate-500">{emptyDescription}</p>
    </section>
  );
}
