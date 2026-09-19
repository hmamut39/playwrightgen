import "server-only";

import { z } from "zod";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import type { PreviewRunResult } from "@/lib/free-tools/preview-run/execute";
import { planPreviewRun } from "@/lib/free-tools/preview-run/plan";
import { runVerdict } from "@/lib/free-tools/preview-run/receipt";
import { executeLiveRun, prepareLiveRun } from "@/lib/free-tools/preview-run/run-draft";
import { siteUrl } from "@/lib/site";

/**
 * Daily live checks: approved automation, run where the project runs.
 *
 * Run evidence used to arrive only from a team's own CI, so a project without
 * CI wired up had approved tests and no idea whether they still passed. With
 * live checks on, each approved browser test is replayed on the project's live
 * URL every day and recorded as an ordinary run attempt, so a test that starts
 * failing shows up as a regression in the places that already read attempts --
 * Quality, Release, the test's own runs -- with nothing to set up.
 *
 * What it will not do is as important. It runs only approved automation for the
 * test case's current approved version. It never stores a test account, so a
 * test that needs one (process.env values for a sign-in) is listed as not
 * checked rather than run half-way and reported as broken. It makes no model
 * calls, so it costs nothing from the AI allowance.
 *
 * The day a passing test starts failing (or a failing one passes again) the
 * round says so on the project and the workspace home, and -- when the team
 * has given one -- posts it to their Slack or Discord channel.
 */

/** A live check should not run again sooner than this. */
const MIN_INTERVAL_MS = 20 * 60 * 60_000;

export type LiveChecksSummary = {
  checked: number;
  passed: number;
  failed: number;
  partial: number;
  /**
   * Approved tests left out, and why, so the page can say so. `regenerate`
   * marks the ones a new version generated from the live page would fix.
   */
  notChecked: Array<{ title: string; reason: string; testCaseId?: string; automationArtifactId?: string; regenerate?: boolean }>;
  /** Every test failing in this round; `newToday` when it passed last time. */
  failing: Array<{ title: string; testCaseId: string; detail: string; newToday: boolean }>;
  /** Tests that failed last time and passed in this round. */
  recovered: Array<{ title: string; testCaseId: string }>;
  /** Whether the team's channel was told about a change, when there was one. */
  alert: "sent" | "failed" | null;
  ranAt: string;
};

export class LiveChecksError extends Error {
  constructor(readonly code: "live_url_required" | "not_found" | "invalid_webhook") {
    super(code);
    this.name = "LiveChecksError";
  }
}

function client(dependencies?: { prisma?: PrismaClient }) {
  return dependencies?.prisma ?? getPrismaClient();
}

/** Turns the daily checks on or off. Whoever turns them on is who they run as. */
export async function setLiveChecks(
  input: { orgSlug?: string; projectId: string; enabled: boolean },
  dependencies?: WorkspaceContextDependencies,
) {
  const projectId = z.string().uuid().parse(input.projectId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "project:update" },
    dependencies,
  );
  const project = await client(dependencies).project.findUnique({
    where: { organizationId_id: { organizationId: workspace.organization.id, id: projectId } },
    select: { liveUrl: true },
  });
  if (!project) throw new LiveChecksError("not_found");
  if (input.enabled && !project.liveUrl) throw new LiveChecksError("live_url_required");
  await client(dependencies).project.update({
    where: { organizationId_id: { organizationId: workspace.organization.id, id: projectId } },
    data: input.enabled
      ? { liveChecksEnabled: true, liveChecksActorUserId: workspace.user.id }
      : { liveChecksEnabled: false },
  });
}

/**
 * Only incoming-webhook addresses of the chat tools we format for. An allow
 * list rather than "any public URL": the server posts to it unattended every
 * day, so it must not be pointable at arbitrary hosts.
 */
export function webhookKind(value: string): "slack" | "discord" | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (url.hostname === "hooks.slack.com" && url.pathname.startsWith("/services/")) return "slack";
  if ((url.hostname === "discord.com" || url.hostname === "discordapp.com") && url.pathname.startsWith("/api/webhooks/")) {
    return "discord";
  }
  return null;
}

/** Shown back on the page: which channel type, never the secret path. */
export function describeWebhook(value: string | null) {
  if (!value) return null;
  const kind = webhookKind(value);
  return kind === "slack" ? "a Slack channel" : kind === "discord" ? "a Discord channel" : null;
}

/** Sets or clears where live-check changes are posted. Empty clears it. */
export async function setLiveChecksWebhook(
  input: { orgSlug?: string; projectId: string; webhookUrl: string },
  dependencies?: WorkspaceContextDependencies,
) {
  const projectId = z.string().uuid().parse(input.projectId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "project:update" },
    dependencies,
  );
  const webhookUrl = input.webhookUrl.trim();
  if (webhookUrl && (webhookUrl.length > 2_000 || !webhookKind(webhookUrl))) throw new LiveChecksError("invalid_webhook");
  const updated = await client(dependencies).project.updateMany({
    where: { organizationId: workspace.organization.id, id: projectId },
    data: { liveChecksWebhookUrl: webhookUrl || null },
  });
  if (updated.count !== 1) throw new LiveChecksError("not_found");
}

type AlertMessage = { projectName: string; liveUrl: string; link: string; failing: LiveChecksSummary["failing"]; recovered: LiveChecksSummary["recovered"] };

export function alertText(message: AlertMessage) {
  const started = message.failing.filter((entry) => entry.newToday);
  const lines = [
    `PlaywrightGen daily live check -- ${message.projectName} (${message.liveUrl})`,
    started.length ? `${started.length} test${started.length === 1 ? "" : "s"} started failing today:` : null,
    ...started.slice(0, 10).map((entry) => `- ${entry.title}${entry.detail ? ` -- ${entry.detail.split("\n")[0].slice(0, 160)}` : ""}`),
    message.recovered.length ? `${message.recovered.length} test${message.recovered.length === 1 ? "" : "s"} passing again:` : null,
    ...message.recovered.slice(0, 10).map((entry) => `- ${entry.title}`),
    `Evidence: ${message.link}`,
  ];
  return lines.filter((line) => line !== null).join("\n");
}

type Poster = (url: string, body: string) => Promise<boolean>;

const postToWebhook: Poster = async (url, body) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    // Never followed: a redirect (Slack answers an unknown hook with one) is a refusal.
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  return response.ok;
};

async function sendAlert(webhookUrl: string, message: AlertMessage, post: Poster): Promise<"sent" | "failed"> {
  const kind = webhookKind(webhookUrl);
  if (!kind) return "failed";
  const content = alertText(message);
  const body = kind === "slack" ? { text: content } : { content: content.slice(0, 2_000), allowed_mentions: { parse: [] } };
  try {
    return (await post(webhookUrl, JSON.stringify(body))) ? "sent" : "failed";
  } catch (error) {
    console.error("[live-checks] alert could not be sent", error instanceof Error ? error.message : error);
    return "failed";
  }
}

export function readLiveChecksSummary(value: Prisma.JsonValue | null): LiveChecksSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const summary = value as Record<string, unknown>;
  const number = (key: string) => (typeof summary[key] === "number" ? (summary[key] as number) : 0);
  if (typeof summary.ranAt !== "string") return null;
  return {
    checked: number("checked"),
    passed: number("passed"),
    failed: number("failed"),
    partial: number("partial"),
    notChecked: Array.isArray(summary.notChecked)
      ? summary.notChecked.flatMap((entry) =>
          entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.title === "string" && typeof entry.reason === "string"
            ? [
                {
                  title: entry.title,
                  reason: entry.reason,
                  ...(typeof entry.testCaseId === "string" ? { testCaseId: entry.testCaseId } : {}),
                  ...(typeof entry.automationArtifactId === "string" ? { automationArtifactId: entry.automationArtifactId } : {}),
                  ...(entry.regenerate === true ? { regenerate: true } : {}),
                },
              ]
            : [],
        )
      : [],
    failing: Array.isArray(summary.failing)
      ? summary.failing.flatMap((entry) =>
          entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.title === "string" && typeof entry.testCaseId === "string"
            ? [{ title: entry.title, testCaseId: entry.testCaseId, detail: typeof entry.detail === "string" ? entry.detail : "", newToday: entry.newToday === true }]
            : [],
        )
      : [],
    recovered: Array.isArray(summary.recovered)
      ? summary.recovered.flatMap((entry) =>
          entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.title === "string" && typeof entry.testCaseId === "string"
            ? [{ title: entry.title, testCaseId: entry.testCaseId }]
            : [],
        )
      : [],
    alert: summary.alert === "sent" || summary.alert === "failed" ? summary.alert : null,
    ranAt: summary.ranAt,
  };
}

/** Tests that started failing in a round from the last two days, for the workspace home. */
export function recentlyStartedFailing(summary: LiveChecksSummary | null, now = Date.now()) {
  if (!summary || now - Date.parse(summary.ranAt) > 48 * 60 * 60_000) return [];
  return summary.failing.filter((entry) => entry.newToday);
}

/**
 * Why an approved test cannot run unattended, and whether generating it again
 * from the live page would fix that; null when it can run.
 */
export function checkability(code: string): { reason: string; regenerate: boolean } | null {
  const plan = planPreviewRun(code);
  if (plan.tests.length === 0) return { reason: "No test could be read from the code.", regenerate: true };
  const operations = [...plan.beforeEach, ...plan.tests.flatMap((test) => test.steps.flatMap((step) => step.operations))];
  const needs = operations.find((operation) => operation.op === "unsupported" && /from your environment$/.test(operation.reason));
  if (needs && needs.op === "unsupported") {
    const name = needs.reason.replace(/^needs /, "").replace(/ from your environment$/, "");
    // An account is a real input the team holds; a selector or URL in the
    // environment is a guess the live page can replace.
    return /USER|PASS|EMAIL|LOGIN|TOKEN|SECRET|KEY/i.test(name)
      ? { reason: `It needs ${name}, and test accounts are never stored.`, regenerate: false }
      : {
          reason: `It reads ${name} from your environment, which a scheduled check does not have. Generate it again from the live page so it names the page's own controls.`,
          regenerate: true,
        };
  }
  return null;
}

/** Why an approved test cannot run unattended, or null when it can. */
export function whyNotCheckable(code: string): string | null {
  return checkability(code)?.reason ?? null;
}

function failureOf(result: PreviewRunResult) {
  for (const test of result.tests) {
    for (const step of test.steps) {
      const failed = step.operations.find((operation) => operation.status === "failed");
      if (failed) return `${step.name}: ${failed.source}\n${failed.detail ?? ""}`.slice(0, 5_000);
    }
  }
  return "";
}

type Runner = (code: string, pageUrl: string) => Promise<PreviewRunResult>;

const runOnPage: Runner = async (code, pageUrl) => {
  const prepared = prepareLiveRun({ code, pageUrl });
  if (!prepared.ok) throw new Error(prepared.error);
  return (await executeLiveRun(prepared.run)).result;
};

/**
 * One round of checks for one project: every approved browser automation that
 * matches its test case's current approved version, run on the live URL, each
 * result recorded as a run attempt. Stops early when `deadline` passes and
 * picks up the rest next round.
 */
export async function runLiveChecksForProject(
  projectId: string,
  options: { deadline?: number; prisma?: PrismaClient; runner?: Runner; post?: Poster } = {},
): Promise<LiveChecksSummary | null> {
  const prisma = client(options);
  const runner = options.runner ?? runOnPage;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      organizationId: true,
      status: true,
      liveUrl: true,
      liveChecksEnabled: true,
      liveChecksActorUserId: true,
      liveChecksWebhookUrl: true,
      name: true,
      organization: { select: { slug: true } },
    },
  });
  if (!project || project.status !== "ACTIVE" || !project.liveChecksEnabled || !project.liveUrl || !project.liveChecksActorUserId) {
    return null;
  }
  const { organizationId, liveUrl } = project;
  const actorUserId = project.liveChecksActorUserId;

  const artifacts = await prisma.automationArtifact.findMany({
    where: {
      organizationId,
      projectId,
      engine: "PLAYWRIGHT_BROWSER",
      approvedVersionNumber: { not: null },
      status: { not: "ARCHIVED" },
    },
    include: {
      testCase: { select: { id: true, title: true, status: true, currentVersionNumber: true } },
      testCaseVersion: { select: { id: true, versionNumber: true } },
      versions: { select: { versionNumber: true, code: true } },
    },
    orderBy: { updatedAt: "asc" },
  });

  const summary: LiveChecksSummary = {
    checked: 0,
    passed: 0,
    failed: 0,
    partial: 0,
    notChecked: [],
    failing: [],
    recovered: [],
    alert: null,
    ranAt: new Date().toISOString(),
  };
  for (const artifact of artifacts) {
    const title = artifact.testCase.title;
    const ids = { testCaseId: artifact.testCase.id, automationArtifactId: artifact.id };
    // Only automation for what is approved now: an artifact pinned to an older
    // version describes behaviour the team has since changed.
    if (artifact.testCase.status !== "APPROVED" || artifact.testCaseVersion.versionNumber !== artifact.testCase.currentVersionNumber) {
      summary.notChecked.push({
        title,
        reason: "Its automation covers an older version of the test case.",
        ...ids,
        regenerate: artifact.testCase.status === "APPROVED",
      });
      continue;
    }
    const code = artifact.versions.find((version) => version.versionNumber === artifact.approvedVersionNumber)?.code ?? "";
    const blocked = checkability(code);
    if (blocked) {
      summary.notChecked.push({ title, reason: blocked.reason, ...ids, ...(blocked.regenerate ? { regenerate: true } : {}) });
      continue;
    }
    if (options.deadline && Date.now() > options.deadline) {
      summary.notChecked.push({ title, reason: "Not reached in this round; it runs in the next one." });
      continue;
    }

    const startedAt = Date.now();
    let result: PreviewRunResult;
    try {
      result = await runner(code, liveUrl);
    } catch (error) {
      console.error("[live-checks] run failed to start", error);
      summary.notChecked.push({ title, reason: "The browser could not be reached; it runs in the next round." });
      continue;
    }
    const verdict = runVerdict(result);
    const outcome = verdict === "passed" ? "PASSED" : verdict === "failed" ? "FAILED" : "BLOCKED";
    summary.checked += 1;
    if (verdict === "passed") summary.passed += 1;
    else if (verdict === "failed") summary.failed += 1;
    else summary.partial += 1;

    const failureDetails = outcome === "FAILED" ? failureOf(result) : "";
    const previous = await recordAttempt(prisma, {
      organizationId,
      projectId,
      testCaseId: artifact.testCase.id,
      testCaseVersionId: artifact.testCaseVersion.id,
      name: artifact.name,
      liveUrl,
      actorUserId,
      outcome,
      durationMs: Date.now() - startedAt,
      counts: result.counts,
      failureDetails,
      steps: result.tests.flatMap((test) => test.steps),
    });
    // A change is judged against this test's last recorded result, from CI or
    // a person as much as from yesterday's check.
    if (outcome === "FAILED") {
      summary.failing.push({ title, testCaseId: artifact.testCase.id, detail: failureDetails.slice(0, 500), newToday: previous === "PASSED" });
    } else if (outcome === "PASSED" && previous === "FAILED") {
      summary.recovered.push({ title, testCaseId: artifact.testCase.id });
    }
  }

  const changed = summary.failing.some((entry) => entry.newToday) || summary.recovered.length > 0;
  if (changed && project.liveChecksWebhookUrl) {
    summary.alert = await sendAlert(
      project.liveChecksWebhookUrl,
      {
        projectName: project.name,
        liveUrl,
        link: `${siteUrl()}/workspace/${project.organization.slug}/projects/${projectId}/overview`,
        failing: summary.failing,
        recovered: summary.recovered,
      },
      options.post ?? postToWebhook,
    );
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { liveChecksLastRunAt: new Date(), liveChecksLastSummary: summary as unknown as Prisma.InputJsonValue },
  });
  return summary;
}

/** Records one result; returns the run's status before it, or null for a first run. */
async function recordAttempt(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    projectId: string;
    testCaseId: string;
    testCaseVersionId: string;
    name: string;
    liveUrl: string;
    actorUserId: string;
    outcome: "PASSED" | "FAILED" | "BLOCKED";
    durationMs: number;
    counts: PreviewRunResult["counts"];
    failureDetails: string;
    steps: PreviewRunResult["tests"][number]["steps"];
  },
) {
  return prisma.$transaction(async (transaction) => {
    const existing = await transaction.testRun.findFirst({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        testCaseVersionId: input.testCaseVersionId,
        mode: "PLAYWRIGHT_BROWSER",
        status: { not: "CANCELED" },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, latestAttemptNumber: true, status: true },
    });
    const testRun =
      existing ??
      (await transaction.testRun.create({
        data: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          testCaseId: input.testCaseId,
          testCaseVersionId: input.testCaseVersionId,
          name: input.name.slice(0, 300),
          status: "NOT_STARTED",
          mode: "PLAYWRIGHT_BROWSER",
          environment: "OTHER",
          browser: "CHROMIUM",
          baseUrl: input.liveUrl,
          createdByUserId: input.actorUserId,
        },
        select: { id: true, latestAttemptNumber: true, status: true },
      }));
    const previous = existing ? existing.status : null;

    const attemptNumber = testRun.latestAttemptNumber + 1;
    const updated = await transaction.testRun.updateMany({
      where: { id: testRun.id, latestAttemptNumber: testRun.latestAttemptNumber, status: { not: "CANCELED" } },
      data: { status: input.outcome, latestAttemptNumber: attemptNumber },
    });
    if (updated.count !== 1) return previous;

    const attempt = await transaction.testRunAttempt.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        testRunId: testRun.id,
        attemptNumber,
        result: input.outcome,
        mode: "PLAYWRIGHT_BROWSER",
        environment: "OTHER",
        browser: "CHROMIUM",
        baseUrl: input.liveUrl,
        durationMs: input.durationMs,
        summary: `Daily live check on ${input.liveUrl}: ${input.counts.passed} checks passed${input.counts.failed ? `, ${input.counts.failed} failed` : ""}${input.counts.skipped + input.counts.notReached ? `, ${input.counts.skipped + input.counts.notReached} not run` : ""}.`,
        sourceRef: "live-check",
        failureDetails: input.failureDetails,
        stepResults: input.steps.map((step, stepIndex) => ({
          stepIndex,
          result: step.status === "passed" ? "PASSED" : step.status === "failed" ? "FAILED" : "BLOCKED",
          notes: step.name.slice(0, 5_000),
        })) as Prisma.InputJsonValue,
        evidence: [{ kind: "LINK", label: "Page checked", url: input.liveUrl }] as Prisma.InputJsonValue,
        executedByUserId: input.actorUserId,
      },
      select: { id: true },
    });
    await transaction.activity.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorUserId: input.actorUserId,
        source: "SYSTEM",
        action: "TEST_RUN_ATTEMPT_RECORDED",
        targetType: "TEST_RUN_ATTEMPT",
        targetId: attempt.id,
        metadata: { testRunId: testRun.id, attemptNumber, result: input.outcome, mode: "PLAYWRIGHT_BROWSER", provider: "live-check" },
      },
    });
    return previous;
  });
}

/**
 * The scheduled round: projects with checks on whose last round is at least
 * most of a day old, oldest first, until the time budget runs out.
 */
export async function runDueLiveChecks(options: { budgetMs: number; prisma?: PrismaClient; runner?: Runner; post?: Poster }) {
  const prisma = client(options);
  const deadline = Date.now() + options.budgetMs;
  const due = await prisma.project.findMany({
    where: {
      status: "ACTIVE",
      liveChecksEnabled: true,
      liveUrl: { not: null },
      OR: [{ liveChecksLastRunAt: null }, { liveChecksLastRunAt: { lt: new Date(Date.now() - MIN_INTERVAL_MS) } }],
    },
    orderBy: { liveChecksLastRunAt: { sort: "asc", nulls: "first" } },
    select: { id: true },
    take: 50,
  });
  const rounds: Array<{ projectId: string; summary: LiveChecksSummary | null }> = [];
  for (const project of due) {
    if (Date.now() > deadline) break;
    rounds.push({ projectId: project.id, summary: await runLiveChecksForProject(project.id, { deadline, prisma, runner: options.runner, post: options.post }) });
  }
  return { due: due.length, ran: rounds.length, rounds };
}
