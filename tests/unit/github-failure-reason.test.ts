import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { githubFailureReason, isKnownGitHubFailure } from "@/lib/integrations/github/failure-reason";

/**
 * What a failed connection tells the person who caused it.
 *
 * Fifteen causes used to arrive at "GitHub access or repository evidence could
 * not be verified": a suspended installation, a repository that is not public,
 * an App whose permissions no longer match, a repository renamed since it was
 * connected. Each has a fix that takes a minute once it is named, and none of
 * them was.
 *
 * The last test is the one that matters over time. A code added later falls
 * back to the general message silently and forever, so every code the services
 * can throw has to be either explained or listed here as deliberately general.
 */

/** Codes with no action to offer, so the general message is the honest one. */
const DELIBERATELY_GENERAL = new Set([
  // Both are failures of the exchange itself. There is nothing for the person
  // to change, and naming the step would only describe our plumbing.
  "github_oauth_exchange_failed",
  "github_oauth_response_invalid",
  // These reach the person through the pull request flow, which has its own
  // wording at the point of use.
  "github_pull_request_empty",
  "github_pull_request_permission_missing",
  // An internal guard: a repository id that is not a number never comes from
  // anything the person typed.
  "github_repository_id_invalid",
]);

function thrownCodes(): string[] {
  const files = [
    "lib/integrations/github/app-client.ts",
    "lib/integrations/github/pull-request.ts",
    "lib/services/repository-imports.ts",
  ];
  const found = new Set<string>();
  for (const file of files) {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    for (const match of source.matchAll(
      /new (?:GitHubProviderError|RepositoryImportDomainError)\(\s*"([a-z_]+)"/g,
    )) {
      found.add(match[1]);
    }
  }
  return [...found].sort();
}

describe("what a failed GitHub connection says", () => {
  it("names the fix for causes a person can act on", () => {
    expect(githubFailureReason("github_installation_suspended")).toContain("suspended");
    expect(githubFailureReason("github_repository_not_public")).toContain("not public");
    expect(githubFailureReason("repository_identity_mismatch")).toContain("renamed");
    // The repository is not the problem, and saying so saves the first hour of
    // looking at it.
    expect(githubFailureReason("github_permissions_not_least_privilege")).toContain(
      "rather than anything about your repository",
    );
  });

  it("says nothing for a code it does not recognise", () => {
    // Anything unknown falls through to the general message rather than being
    // rendered as advice, and a value arriving in a URL renders nothing.
    expect(githubFailureReason("something_invented_later")).toBeNull();
    expect(githubFailureReason("<script>alert(1)</script>")).toBeNull();
    expect(githubFailureReason("")).toBeNull();
    expect(githubFailureReason(undefined)).toBeNull();
    expect(isKnownGitHubFailure("something_invented_later")).toBe(false);
  });

  it("never names a credential", () => {
    for (const code of thrownCodes()) {
      const reason = githubFailureReason(code);
      if (!reason) continue;
      expect(reason.toLowerCase()).not.toMatch(/token|secret|private key|password/);
    }
  });

  it("has an answer, or a decision not to, for every code that can be thrown", () => {
    const unhandled = thrownCodes().filter(
      (code) => !isKnownGitHubFailure(code) && !DELIBERATELY_GENERAL.has(code),
    );

    // A code added later would otherwise fall back to the general message
    // silently, which is how fifteen causes came to share one sentence.
    expect(unhandled, `no wording decided for: ${unhandled.join(", ")}`).toEqual([]);
  });
});
