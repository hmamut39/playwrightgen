import { describe, expect, it } from "vitest";

import {
  buildListResult,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  parseListParams,
} from "@/lib/services/list-query";

describe("parseListParams", () => {
  it("defaults to the first page when nothing is supplied", () => {
    const params = parseListParams({});

    expect(params).toMatchObject({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      skip: 0,
      take: DEFAULT_PAGE_SIZE,
      search: "",
    });
    expect(params.contains).toBeUndefined();
  });

  it("computes the offset from the page", () => {
    expect(parseListParams({ page: 3, pageSize: 10 }).skip).toBe(20);
  });

  it("builds a case-insensitive filter only when searching", () => {
    expect(parseListParams({ search: "Checkout" }).contains).toEqual({
      contains: "Checkout",
      mode: "insensitive",
    });
    // A blank search must not become a filter matching everything slowly.
    expect(parseListParams({ search: "   " }).contains).toBeUndefined();
  });

  it("falls back to the first page rather than throwing on a bad link", () => {
    // A malformed page is someone's stale bookmark, not a reason to show them
    // an error instead of their data.
    expect(parseListParams({ page: -5 }).page).toBe(1);
    expect(parseListParams({ page: 0 }).page).toBe(1);
    expect(parseListParams({ pageSize: 0 }).pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("refuses a page size beyond the maximum", () => {
    // Otherwise a crafted URL turns any list into an unbounded query again.
    expect(parseListParams({ pageSize: MAX_PAGE_SIZE + 1 }).pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(parseListParams({ pageSize: MAX_PAGE_SIZE }).pageSize).toBe(MAX_PAGE_SIZE);
  });

  it("trims and caps the search term", () => {
    expect(parseListParams({ search: "  checkout  " }).search).toBe("checkout");
    expect(parseListParams({ search: "x".repeat(500) }).search).toBe("");
  });
});

describe("buildListResult", () => {
  it("reports the page count for a partial final page", () => {
    const result = buildListResult([1, 2], 52, { page: 3, pageSize: 25, search: "" });

    expect(result).toMatchObject({ total: 52, page: 3, pageSize: 25, pageCount: 3 });
    expect(result.items).toEqual([1, 2]);
  });

  it("reports one page when there is nothing to show", () => {
    // Zero pages would render "Page 1 of 0", which reads as broken.
    expect(buildListResult([], 0, { page: 1, pageSize: 25, search: "" }).pageCount).toBe(1);
  });

  it("carries the search term so the view can be described back to the reader", () => {
    expect(
      buildListResult([], 0, { page: 1, pageSize: 25, search: "checkout" }).search,
    ).toBe("checkout");
  });
});
