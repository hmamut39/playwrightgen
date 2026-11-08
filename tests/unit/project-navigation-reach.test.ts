import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Whether a person can get anywhere from the page they are standing on.
 *
 * `ProjectNavigation` carries every part of a project -- Overview,
 * Requirements, Test Cases, Automation, Test Runs, Release and the oversight
 * tabs -- and the list pages all render it. The detail pages did not. So the
 * moment somebody opened a test case, an automation version, a requirement or
 * a test run, the row vanished and the only way onward was the browser's Back
 * button or the one "<- Test Cases" link above the title.
 *
 * Found on 2026-11-08 by the owner, setting up the demo account: after
 * approving an automation version he had to be sent the Overview URL, because
 * nothing on the page he was on could reach it. "How is a real user going to
 * go back from that page?" The product's own four-step path ends on exactly
 * such a page, so every new person would meet this.
 *
 * A source-level test, deliberately: it catches a page added next month that
 * forgets the row, which no test of today's pages would.
 */

const PROJECT_PAGES = "app/workspace/[orgSlug]/projects/[projectId]";

/**
 * Pages that are meant to stand alone.
 *
 * A create form is a decision in progress, and tabs beside it invite leaving
 * it half-filled; the proof link and the printable report are read by people
 * outside the team, who have no project to navigate.
 */
const STANDS_ALONE = new Set([
  "requirements/new/page.tsx",
  "test-cases/new/page.tsx",
  "test-runs/new/page.tsx",
  "release/changes/[proofLinkId]/page.tsx",
  "release/report/page.tsx",
]);

async function projectPages(dir: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const next = join(dir, entry.name);
    const label = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await projectPages(next, label)));
    else if (entry.name === "page.tsx") found.push(label);
  }
  return found;
}

describe("getting around a project", () => {
  it("puts the navigation on every page inside a project", async () => {
    const pages = await projectPages(PROJECT_PAGES);
    expect(pages.length).toBeGreaterThan(10);

    const missing: string[] = [];
    for (const page of pages) {
      if (STANDS_ALONE.has(page)) continue;
      const source = await readFile(join(PROJECT_PAGES, page), "utf8");
      if (!source.includes("<ProjectNavigation")) missing.push(page);
    }

    expect(missing, "these pages are dead ends: nothing on them reaches the rest of the project").toEqual([]);
  });

  it("counts the detail pages as pages people stand on, not as exceptions", async () => {
    // The four that were missing it. Named so that quietly adding one to the
    // list above, rather than adding the row to the page, fails here.
    for (const page of [
      "test-cases/[testCaseId]/page.tsx",
      "automation/[automationArtifactId]/page.tsx",
      "requirements/[requirementId]/page.tsx",
      "test-runs/[testRunId]/page.tsx",
    ]) {
      expect(STANDS_ALONE.has(page), `${page} is where the work happens; it cannot stand alone`).toBe(false);
      const source = await readFile(join(PROJECT_PAGES, page), "utf8");
      expect(source).toContain("<ProjectNavigation");
    }
  });
});
