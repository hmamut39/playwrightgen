import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The four steps a brand-new workspace is given, against what the code does.
 *
 * Found on 2026-10-19, walking a mock company through exactly those steps.
 * Step four read "Approve, then let it watch the site -- Approving turns a
 * test into evidence. After that, daily checks run it on your site and tell
 * you the day it breaks."
 *
 * Daily checks do not start. `liveChecksEnabled` defaults to false and the
 * only thing that sets it true is a person pressing the switch on Health or
 * Overview. A team following these four steps exactly would approve their
 * tests, believe their site was being watched, and discover otherwise on the
 * day it broke -- the one day this product exists to tell them about.
 *
 * Checked against the schema and the service rather than against a copy of
 * the sentence, so the test fails if either the promise or the behaviour
 * moves away from the other.
 */
const root = resolve(__dirname, "..", "..");
/**
 * Source with its comments removed.
 *
 * The comments explaining these fixes quote the sentences being removed, so
 * a test reading the raw file finds the old wording in the note saying why it
 * went. What ships to a reader is the code, not the commentary.
 */
const read = (file: string) =>
  readFileSync(join(root, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("the four steps shown to a new workspace", () => {
  const steps = read("app/workspace/[orgSlug]/page.tsx");
  const schema = read("prisma/schema.prisma");

  it("still has daily checks off until someone turns them on", () => {
    // The premise of this whole test. If this ever changes, the sentence may
    // promise more again -- but only then.
    expect(schema).toMatch(/liveChecksEnabled\s+Boolean\s+@default\(false\)/);
  });

  it("does not promise daily checks start by themselves after approval", () => {
    expect(steps).not.toContain("After that, daily checks run it on your site");
  });

  it("tells the reader daily checks are something they switch on", () => {
    const stepsBlock = steps.slice(steps.indexOf("const FIRST_STEPS"), steps.indexOf("];", steps.indexOf("const FIRST_STEPS")));
    expect(stepsBlock).toMatch(/switch on daily checks/i);
  });

  it("does not promise it on the MCP page either", () => {
    // The same sentence sat in a list headed "what the workspace adds once a
    // proposed test has been approved", where it read as approval being
    // enough. Fixing one copy and leaving the other is how a claim survives.
    const mcp = read("app/mcp/page.tsx");
    expect(mcp).not.toContain("Daily checks run it on your live site");
    expect(mcp).toMatch(/Daily checks, once you switch them on/);
  });

  it("still promises what approval genuinely does", () => {
    // The fix is accuracy, not retreat: approving really does turn a test
    // into evidence, and that sentence stays.
    expect(steps).toContain("Approving turns a test into evidence");
  });
});
