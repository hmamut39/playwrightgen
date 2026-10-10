import type { ActivityAction } from "@/generated/prisma/client";

/**
 * The one line of detail behind an activity entry.
 *
 * Every row already carries metadata -- which pipeline delivered results and
 * how many were recorded, which attempt failed and on which commit, which
 * version of the automation was generated -- and the feed threw all of it away
 * and printed the verb. "Received results from CI" eleven times tells a lead
 * nothing, while the rows underneath knew that ten of those deliveries recorded
 * nothing.
 *
 * Read defensively. These rows are history and outlive the shape that wrote
 * them, so a missing or unexpected field returns no detail rather than a
 * confident-looking blank.
 */

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;

const PROVIDERS: Record<string, string> = {
  github_actions: "GitHub Actions",
  gitlab_ci: "GitLab CI",
  jenkins: "Jenkins",
  azure_pipelines: "Azure Pipelines",
  other: "CI",
};

const ENGINES: Record<string, string> = {
  PLAYWRIGHT_BROWSER: "Playwright Browser",
  PLAYWRIGHT_API: "Playwright API",
};

const words = (value: string) => value.replace(/_/g, " ").toLowerCase();

export function activityDetail(
  action: ActivityAction,
  metadata: unknown,
): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const data = metadata as Record<string, unknown>;
  const parts: string[] = [];

  switch (action) {
    case "CI_RESULTS_REJECTED": {
      const provider = text(data.provider);
      if (provider) parts.push(PROVIDERS[provider] ?? "CI");
      const ref = text(data.ref);
      if (ref) parts.push(ref);
      const reason = text(data.reason);
      // The reason is the row: a refused delivery is only worth recording
      // because the team cannot otherwise tell why it was refused.
      if (reason === "stale_token") parts.push("an old project token");
      else if (reason === "connection_inactive") parts.push("no active repository connection");
      else if (reason) parts.push(words(reason));
      break;
    }

    case "CI_RESULTS_DELIVERED": {
      const provider = text(data.provider);
      if (provider) parts.push(PROVIDERS[provider] ?? "CI");
      const ref = text(data.ref);
      if (ref) parts.push(ref);
      const recorded = count(data.recorded);
      const total = count(data.total);
      if (recorded !== null && total !== null) {
        // The number a lead is actually scanning for: a delivery that recorded
        // nothing is the one worth stopping on.
        parts.push(`${recorded} of ${total} recorded`);
      }
      break;
    }

    case "TEST_RUN_ATTEMPT_RECORDED": {
      const attempt = count(data.attemptNumber);
      if (attempt !== null) parts.push(`attempt ${attempt}`);
      const result = text(data.result);
      if (result) parts.push(words(result));
      const provider = text(data.provider);
      if (provider) parts.push(PROVIDERS[provider] ?? "CI");
      const commit = text(data.commitSha);
      if (commit) parts.push(commit.slice(0, 8));
      break;
    }

    case "AUTOMATION_VERSION_GENERATED": {
      const version = count(data.versionNumber);
      if (version !== null) parts.push(`v${version}`);
      const engine = text(data.engine);
      if (engine) parts.push(ENGINES[engine] ?? words(engine));
      const generation = text(data.generationStatus);
      if (generation) parts.push(words(generation));
      break;
    }

    case "AUTOMATION_PULL_REQUEST_OPENED": {
      const repository = text(data.repository);
      const number = count(data.pullRequestNumber);
      if (repository && number !== null) parts.push(`${repository} #${number}`);
      else if (repository) parts.push(repository);
      if (data.alreadyOpen === true) parts.push("already open");
      break;
    }

    case "REPOSITORY_IMPORT_COMPLETED": {
      const ref = text(data.sourceRef);
      const commit = text(data.commitSha);
      if (ref && commit) parts.push(`${ref} @ ${commit.slice(0, 8)}`);
      else if (ref) parts.push(ref);
      const files = count(data.testFileCount);
      if (files !== null) parts.push(`${files} test file${files === 1 ? "" : "s"}`);
      const tests = count(data.discoveredTestCount);
      if (tests !== null) parts.push(`${tests} test${tests === 1 ? "" : "s"} found`);
      break;
    }

    default: {
      // Everything else: the version it happened to, when the row says so.
      // A version number is the difference between "revised a requirement"
      // and knowing which revision a reader should go and read.
      const version = count(data.versionNumber);
      if (version !== null) parts.push(`version ${version}`);
      break;
    }
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}
