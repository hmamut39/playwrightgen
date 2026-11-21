import { describe, expect, it } from "vitest";

import { isProjectId } from "@/lib/auth/workspace-context";

/**
 * Whether an address could be a project at all.
 *
 * The id went straight into a findUnique against a uuid column, so anything
 * that is not a uuid made PostgreSQL reject the query and the page answered
 * 500. The reader was then told:
 *
 *   "This page didn't load. If you just created your workspace, it may still
 *    be finishing setup. Trying again usually works."
 *
 * Every word of that is false for a mistyped or stale URL. Nothing is
 * finishing, and trying again will never work -- so the person waits, retries,
 * and concludes the product is broken rather than that the address is wrong.
 *
 * Found on 2026-11-21 while walking the workspace as a new member: a script
 * followed /projects/new as though it were an id and every tab under it
 * answered 500 with that message.
 */
describe("an address that could be a project", () => {
  it("accepts a real identifier", () => {
    expect(isProjectId("3b6c7a52-3b4e-4c65-8a35-1a2b3c4d5e6f")).toBe(true);
    // Case is not the caller's problem.
    expect(isProjectId("3B6C7A52-3B4E-4C65-8A35-1A2B3C4D5E6F")).toBe(true);
  });

  it("rejects the path segments that sit beside a project id", () => {
    // These are real addresses in this product: /projects/new is the create
    // form, and a tab name arrives here when a link is built wrongly.
    for (const value of ["new", "overview", "quality", "undefined", "null", ""]) {
      expect(isProjectId(value), value).toBe(false);
    }
  });

  it("rejects something uuid-shaped but not a uuid", () => {
    expect(isProjectId("3b6c7a52-3b4e-4c65-8a35-1a2b3c4d5e6")).toBe(false);
    expect(isProjectId("3b6c7a52-3b4e-4c65-8a35-1a2b3c4d5e6fa")).toBe(false);
    expect(isProjectId("zb6c7a52-3b4e-4c65-8a35-1a2b3c4d5e6f")).toBe(false);
    expect(isProjectId("3b6c7a52_3b4e_4c65_8a35_1a2b3c4d5e6f")).toBe(false);
  });

  it("rejects an attempt to smuggle something past the lookup", () => {
    expect(isProjectId("3b6c7a52-3b4e-4c65-8a35-1a2b3c4d5e6f' OR '1'='1")).toBe(false);
    expect(isProjectId("../../etc/passwd")).toBe(false);
  });
});
