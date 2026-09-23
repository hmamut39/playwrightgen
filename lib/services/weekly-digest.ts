import "server-only";

import type { PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { buildReleaseEvidenceReport } from "@/lib/services/release-evidence";
import { siteUrl } from "@/lib/site";

/**
 * A week of daily checks, in one message.
 *
 * Checking every day produces a record every day, and nobody reads a list of
 * days. What a team needs on Monday is the difference: what broke, what came
 * back, and what is unreliable. This reads the week's recorded attempts and
 * says only that -- it invents no state of its own, so it can never disagree
 * with the runs it summarises.
 */

const WEEK_MS = 7 * 24 * 60 * 60_000;
/** Two attempts this close together are one round: a failure and its retry. */
const SAME_ROUND_MS = 30 * 60_000;
/** A digest is not sent again inside this window, however often the job runs. */
const MIN_INTERVAL_MS = 6 * 24 * 60 * 60_000;

/**
 * Where the project stands, not only what moved this week.
 *
 * A digest of what broke and recovered answers "what happened"; a lead
 * forwarding it upward is asked "so where are we". Those are different
 * questions, and the second one is about requirements rather than tests.
 */
export type CoverageLine = { verified: number; failing: number; unverified: number; stale: number };

export function coverageText(coverage: CoverageLine) {
  const total = coverage.verified + coverage.failing + coverage.unverified;
  if (total === 0) return null;
  const parts = [`${coverage.verified} verified`];
  if (coverage.failing) parts.push(`${coverage.failing} failing`);
  if (coverage.unverified) parts.push(`${coverage.unverified} not verified`);
  const stale = coverage.stale
    ? ` ${coverage.stale} of the verified ${coverage.stale === 1 ? "was" : "were"} last checked over a month ago.`
    : "";
  return `${total} requirement${total === 1 ? "" : "s"}: ${parts.join(", ")}.${stale}`;
}

export type WeekAttempt = {
  testCaseId: string;
  title: string;
  result: string;
  executedAt: Date;
};

export type WeeklyDigest = {
  /** Passing at the start of the week, failing at the end. */
  broke: string[];
  /** Failing at the start, passing at the end. */
  recovered: string[];
  /** Failed and passed again within one round, at least once. */
  flaky: string[];
  /** Failing all week. */
  stillFailing: string[];
  /** Passed every time it ran. */
  steady: number;
  checked: number;
};

/** The week's attempts, grouped into what a person would say about them. */
export function summariseWeek(attempts: readonly WeekAttempt[]): WeeklyDigest {
  const byTestCase = new Map<string, WeekAttempt[]>();
  for (const attempt of attempts) {
    const bucket = byTestCase.get(attempt.testCaseId);
    if (bucket) bucket.push(attempt);
    else byTestCase.set(attempt.testCaseId, [attempt]);
  }

  const digest: WeeklyDigest = { broke: [], recovered: [], flaky: [], stillFailing: [], steady: 0, checked: byTestCase.size };
  for (const bucket of byTestCase.values()) {
    const ordered = [...bucket].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
    const title = ordered[ordered.length - 1].title;
    const first = ordered[0];
    const last = ordered[ordered.length - 1];

    // A failure followed within the round by a pass is flakiness, whatever the
    // week did overall, and it is worth saying even when the week ends green.
    const flaked = ordered.some(
      (attempt, index) =>
        attempt.result === "FAILED" &&
        ordered[index + 1]?.result === "PASSED" &&
        ordered[index + 1].executedAt.getTime() - attempt.executedAt.getTime() <= SAME_ROUND_MS,
    );
    if (flaked) digest.flaky.push(title);

    if (last.result === "FAILED") {
      if (ordered.some((attempt) => attempt.result === "PASSED")) digest.broke.push(title);
      else digest.stillFailing.push(title);
      continue;
    }
    if (last.result === "PASSED") {
      if (first.result === "FAILED" && !flaked) digest.recovered.push(title);
      else if (!flaked && ordered.every((attempt) => attempt.result === "PASSED")) digest.steady += 1;
    }
  }
  return digest;
}

/** Nothing happened worth a message: everything passed, every day. */
export function isQuietWeek(digest: WeeklyDigest) {
  return digest.broke.length === 0 && digest.recovered.length === 0 && digest.flaky.length === 0 && digest.stillFailing.length === 0;
}

export function digestText(input: {
  projectName: string;
  liveUrl: string;
  link: string;
  digest: WeeklyDigest;
  coverage?: CoverageLine | null;
}) {
  const { digest } = input;
  const list = (label: string, titles: string[]) =>
    titles.length ? [`${label} (${titles.length}):`, ...titles.slice(0, 10).map((title) => `- ${title}`)] : [];
  return [
    `PlaywrightGen week in review -- ${input.projectName} (${input.liveUrl})`,
    `${digest.checked} test${digest.checked === 1 ? "" : "s"} checked daily; ${digest.steady} passed every time.`,
    input.coverage ? coverageText(input.coverage) : null,
    ...list("Broke this week", digest.broke),
    ...list("Still failing", digest.stillFailing),
    ...list("Passing again", digest.recovered),
    ...list("Flaky (failed, then passed on a retry)", digest.flaky),
    `Evidence: ${input.link}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function client(dependencies?: { prisma?: PrismaClient }) {
  return dependencies?.prisma ?? getPrismaClient();
}

/** The week's live-check attempts for one project, newest last. */
export async function readWeek(
  projectId: string,
  options: { prisma?: PrismaClient; now?: Date } = {},
): Promise<WeekAttempt[]> {
  const since = new Date((options.now?.getTime() ?? Date.now()) - WEEK_MS);
  const attempts = await client(options).testRunAttempt.findMany({
    where: { projectId, sourceRef: "live-check", executedAt: { gte: since } },
    orderBy: { executedAt: "asc" },
    select: {
      result: true,
      executedAt: true,
      testRun: { select: { testCaseId: true, testCase: { select: { title: true } } } },
    },
    take: 2_000,
  });
  return attempts.map((attempt) => ({
    testCaseId: attempt.testRun.testCaseId,
    title: attempt.testRun.testCase.title,
    result: attempt.result,
    executedAt: attempt.executedAt,
  }));
}

type Poster = (url: string, body: string) => Promise<boolean>;

const postToWebhook: Poster = async (url, body) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Never followed: a redirect is a refusal, as it is for the daily alert.
    redirect: "manual",
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok;
};

/**
 * Posts each due project's week to its channel, once a week.
 *
 * A project with no channel gets nothing here: the same week is on its Health
 * page, and mail nobody asked for is worse than no mail.
 */
export async function sendWeeklyDigests(options: {
  budgetMs: number;
  prisma?: PrismaClient;
  post?: Poster;
  now?: Date;
}) {
  const prisma = client(options);
  const now = options.now ?? new Date();
  const deadline = now.getTime() + options.budgetMs;
  const due = await prisma.project.findMany({
    where: {
      status: "ACTIVE",
      liveChecksEnabled: true,
      liveChecksWebhookUrl: { not: null },
      OR: [
        { liveChecksLastDigestAt: null },
        { liveChecksLastDigestAt: { lt: new Date(now.getTime() - MIN_INTERVAL_MS) } },
      ],
    },
    orderBy: { liveChecksLastDigestAt: { sort: "asc", nulls: "first" } },
    select: {
      id: true,
      name: true,
      organizationId: true,
      liveUrl: true,
      liveChecksWebhookUrl: true,
      organization: { select: { slug: true } },
    },
    take: 100,
  });

  let sent = 0;
  let quiet = 0;
  for (const project of due) {
    if (Date.now() > deadline) break;
    const week = await readWeek(project.id, { prisma, now });
    const digest = summariseWeek(week);
    // Nothing ran at all: the project is not being checked, so there is nothing
    // to report and nothing to record either.
    if (digest.checked === 0) continue;
    // Best effort: a digest about a week that really happened must not be
    // lost because the standings could not be read.
    const coverage = await buildReleaseEvidenceReport({
      organizationId: project.organizationId,
      projectId: project.id,
      now,
      prisma: options.prisma,
    })
      .then((report) => report.totals)
      .catch(() => null);
    const standings = coverage ? coverageText(coverage) : null;
    const text = isQuietWeek(digest)
      ? [
          `PlaywrightGen week in review -- ${project.name} (${project.liveUrl ?? ""})`,
          `All ${digest.checked} test${digest.checked === 1 ? "" : "s"} passed every day this week.`,
          standings,
        ]
          .filter((line) => line !== null)
          .join("\n")
      : digestText({
          projectName: project.name,
          liveUrl: project.liveUrl ?? "",
          link: `${siteUrl()}/workspace/${project.organization.slug}/projects/${project.id}/health`,
          digest,
          coverage,
        });
    const kind = /discord(app)?\.com/.test(project.liveChecksWebhookUrl ?? "") ? "discord" : "slack";
    const body = JSON.stringify(
      kind === "discord" ? { content: text.slice(0, 2_000), allowed_mentions: { parse: [] } } : { text },
    );
    try {
      const ok = await (options.post ?? postToWebhook)(project.liveChecksWebhookUrl!, body);
      if (ok) sent += 1;
      if (isQuietWeek(digest)) quiet += 1;
      // Recorded either way: a channel that refuses should not be retried all
      // week, and the week is on the Health page regardless.
      await prisma.project.update({ where: { id: project.id }, data: { liveChecksLastDigestAt: now } });
    } catch (error) {
      console.error("[weekly-digest] could not post", error instanceof Error ? error.message : error);
      await prisma.project.update({ where: { id: project.id }, data: { liveChecksLastDigestAt: now } });
    }
  }
  return { due: due.length, sent, quiet };
}
