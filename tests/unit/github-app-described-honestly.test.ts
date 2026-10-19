import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { GITHUB_PERMISSION_CEILING } from "@/lib/integrations/github/app-client";

/**
 * What the install screen says the GitHub App may do, against what it may do.
 *
 * Found on 2026-10-19 by following the pricing page's promise of "pull
 * requests with approved tests, straight to your repository" to the screen
 * where a team installs the App. That screen called it a "Read-only GitHub
 * App" and listed its permissions as "Metadata and Contents read only".
 *
 * The ceiling is metadata read, contents read and write, pull requests read
 * and write, issues read. Contents write is what commits the test file a pull
 * request proposes; without it the promised feature cannot run. The README
 * says so and `readme-claims.test.ts` checks it. The install screen did not.
 *
 * Understating your own access is the worse direction to be wrong in. A
 * person approving an installation on the strength of the words "read-only"
 * has been told something about their own repository that is not true, and
 * they are the one person not in a position to check. This keeps the screen
 * where somebody grants that access tied to the same constant the README is.
 */
const root = resolve(__dirname, "..", "..");
const page = readFileSync(
  join(root, "app/workspace/[orgSlug]/projects/[projectId]/repositories/page.tsx"),
  "utf8",
);

/** The page text, with the explanatory comments stripped out. */
const visible = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

describe("how the install screen describes the GitHub App", () => {
  it("does not call it read-only", () => {
    expect(visible).not.toMatch(/[Rr]ead-only GitHub App/);
    expect(visible).not.toContain("Install the read-only PlaywrightGen GitHub App");
    expect(visible).not.toContain("Metadata and Contents read only");
  });

  it("names the writes the App can actually hold", () => {
    // Taken from the ceiling rather than retyped, so widening the ceiling
    // without revisiting this screen fails here.
    expect(GITHUB_PERMISSION_CEILING.contents).toContain("write");
    expect(GITHUB_PERMISSION_CEILING.pull_requests).toContain("write");
    expect(visible).toMatch(/contents and pull requests write/i);
  });

  it("still says what it will never do", () => {
    // The reassurance that is true keeps its place: the App opens a pull
    // request and stops.
    expect(visible).toMatch(/never merges/i);
    expect(visible).toMatch(/never pushes to your\s*\n?\s*default branch/i);
  });

  it("keeps issues at read, which is the claim that must never loosen", () => {
    expect(GITHUB_PERMISSION_CEILING.issues).toEqual(["read"]);
  });
});
