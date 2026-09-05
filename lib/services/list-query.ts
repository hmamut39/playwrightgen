import "server-only";

import { z } from "zod";

/**
 * Shared paging and search contract for the workspace list surfaces.
 *
 * Every list previously returned an unbounded `findMany`. That is fine while a
 * project holds ten records and unusable at three hundred: the page grows
 * without limit, the query scans the whole table, and there is no way to find
 * anything. Since Requirements, Test Cases, Test Runs, and Automation all have
 * the same problem, they get the same answer rather than four slightly different
 * ones.
 *
 * Offset paging rather than cursors, deliberately. Cursors are the right choice
 * for infinite feeds; these are finite, human-reviewed lists where people expect
 * to jump to a page and see a total, and a total is itself useful evidence.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export type ListParams = {
  search?: string;
  page?: number;
  pageSize?: number;
};

export type ListResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  search: string;
};

const paramsSchema = z.object({
  // Trimmed and capped: a search term long enough to matter is already far
  // shorter than this, and an unbounded string is an easy way to make the
  // database do pointless work.
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().max(100_000).optional(),
  pageSize: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).optional(),
});

export function parseListParams(input: ListParams) {
  const parsed = paramsSchema.safeParse(input);
  // A malformed page or size is a bad link, not a reason to fail the page, so
  // it falls back to the first page rather than throwing at the reader.
  const data = parsed.success ? parsed.data : {};
  const pageSize = data.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = data.page ?? 1;
  const search = data.search ?? "";

  return {
    search,
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
    /** Prisma filter for a case-insensitive match, or undefined when not searching. */
    contains: search
      ? { contains: search, mode: "insensitive" as const }
      : undefined,
  };
}

export function buildListResult<T>(
  items: T[],
  total: number,
  parsed: { page: number; pageSize: number; search: string },
): ListResult<T> {
  return {
    items,
    total,
    page: parsed.page,
    pageSize: parsed.pageSize,
    pageCount: Math.max(1, Math.ceil(total / parsed.pageSize)),
    search: parsed.search,
  };
}
