import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The CI panel offered three pipelines and could finish one.
 *
 * Found on 2026-10-19, walking a mock company from approved automation to
 * recording results. The panel says tests run "on GitHub Actions, GitLab CI
 * or Jenkins", ships ready-made configuration for all three, and then hid the
 * token behind "Connect a repository above first" -- where the only connector
 * offered is the GitHub App.
 *
 * The reason was real. Every recorded result is kept under a named person,
 * and the only one the product could name was whoever installed the App
 * (`resolveAutomationActor` failed closed otherwise). A connection cannot
 * exist without a `githubInstallationId`, and the CI token is an HMAC that
 * carries no issuer. So a team on GitLab could copy the snippet, set the four
 * variables, and have every delivery refused.
 *
 * The morning's first fix was to say so on the page. The fix this replaces it
 * with is to remove the limit: whoever takes the token is recorded, and
 * ingestion names them when no repository is connected. They hold
 * `repository:connect`, so a lead or an owner, and connecting a pipeline is
 * at least as deliberate as installing an App once -- this widens who can be
 * named without loosening what being named means.
 *
 * This file keeps that reachable. The attribution rule and the screen that
 * feeds it have to stay in step, because either one alone silently breaks the
 * other: a token nobody can take is a pipeline nobody can connect.
 */
const root = resolve(__dirname, "..", "..");
const read = (file: string) =>
  readFileSync(join(root, file), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("recording CI results without a GitHub repository", () => {
  const panel = read("components/workspace/ci-setup-panel.tsx");
  const ingest = read("lib/services/test-run-ingest.ts");
  const setup = read("lib/services/runner-setup.ts");

  it("no longer hides the token until a repository is connected", () => {
    expect(panel).not.toContain("Connect a repository above first.");
    expect(panel).not.toMatch(/Connect a GitHub repository above first/);
  });

  it("says a real person is recorded, without naming a host", () => {
    expect(panel).toMatch(/recorded under a real person/i);
    expect(panel).toMatch(/No GitHub repository is needed/i);
  });

  it("records who took the token, so there is somebody to name", () => {
    // Written on the first read and on every rotation; without this the
    // fallback below can never find anyone.
    expect(setup).toContain("runnerTokenActorUserId: workspace.user.id");
  });

  it("falls back to that person when no repository is connected", () => {
    expect(ingest).toContain("project?.runnerTokenActorUserId");
    // And still prefers the repository connection where there is one, so a
    // GitHub team's attribution does not move.
    const connectionFirst = ingest.indexOf("return connection.createdByUserId");
    const fallback = ingest.indexOf("project?.runnerTokenActorUserId");
    expect(connectionFirst).toBeGreaterThan(-1);
    expect(connectionFirst).toBeLessThan(fallback);
  });

  it("still refuses when there is nobody at all to name", () => {
    // The rule that makes attribution worth anything: no named person, no
    // recorded evidence. Widening who qualifies must not remove the floor.
    expect(ingest).toContain('throw new RunIngestError("repository_connection_inactive", 403)');
  });

  it("still offers the pipelines it can now actually finish", () => {
    const templates = read("lib/ci/templates.ts");
    for (const pipeline of ["GitLab", "Jenkins"]) {
      expect(templates).toContain(pipeline);
    }
  });
});
