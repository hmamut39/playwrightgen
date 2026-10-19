import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The CI panel offers three pipelines and can only finish one.
 *
 * Found on 2026-10-19, walking a mock company from approved automation to
 * recording results. The panel says tests run "on GitHub Actions, GitLab CI
 * or Jenkins", ships ready-made configuration for all three, and then gates
 * everything behind "Connect a repository above first" -- where the only
 * connector offered is the GitHub App.
 *
 * Ingestion attributes every recorded result to a real person, and the only
 * person it can name is whoever created the repository connection
 * (`resolveAutomationActor` fails closed without one). A connection cannot
 * exist without a `githubInstallationId`. So a team whose code lives on
 * GitLab can copy the snippet, set the four variables, and watch every
 * delivery refused with nothing on screen naming the reason.
 *
 * Whether to open ingestion to teams without a GitHub repository is a product
 * decision. Until it is made, the page has to say which pipelines it can
 * actually finish -- the product's own standard, applied to its own claims.
 *
 * Read as source because this is about what the page says, and the panel is a
 * client component whose text is the whole subject.
 */
const root = resolve(__dirname, "..", "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("what the CI panel promises", () => {
  const panel = read("components/workspace/ci-setup-panel.tsx");

  it("names GitHub as the requirement wherever the tests run", () => {
    expect(panel).toMatch(/connected GitHub repository/);
  });

  it("does not leave the gate saying only 'a repository'", () => {
    // The old sentence named no provider, so a GitLab team read it as a step
    // they could take.
    expect(panel).not.toContain("Connect a repository above first.");
    expect(panel).toMatch(/Connect a GitHub repository above first/);
  });

  it("still offers the pipelines whose tests genuinely run anywhere", () => {
    // The fix is honesty about recording, not removing support: the tests do
    // run on any runner, and the templates stay.
    const templates = read("lib/ci/templates.ts");
    for (const pipeline of ["GitLab", "Jenkins"]) {
      expect(templates).toContain(pipeline);
    }
  });

  it("keeps the attribution rule that makes the requirement real", () => {
    // If this stops failing closed, the sentence above becomes wrong and this
    // test should be revisited rather than the sentence quietly left behind.
    const ingest = read("lib/services/test-run-ingest.ts");
    expect(ingest).toContain('throw new RunIngestError("repository_connection_inactive", 403)');
  });
});
