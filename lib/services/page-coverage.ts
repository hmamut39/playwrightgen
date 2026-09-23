import "server-only";

import { z } from "zod";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { repairDraft } from "@/lib/ai/draft-repair";
import { planPageCoverage, type PageCoveragePlan } from "@/lib/ai/page-coverage-plan";
import { generateQuickDraft } from "@/lib/ai/quick-generation";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { extractLocatorNames, normalizeName } from "@/lib/free-tools/locator-names";
import { capturePageSnapshot } from "@/lib/free-tools/page-snapshot";
import { runVerdict } from "@/lib/free-tools/preview-run/receipt";
import { executeLiveRun, prepareLiveRun } from "@/lib/free-tools/preview-run/run-draft";
import { firstFailureOf, proveDraftOnLivePage } from "@/lib/free-tools/prove-loop";
import { isPublicWebAddress } from "@/lib/free-tools/public-address";
import { testAccountSchema, type TestAccount } from "@/lib/free-tools/sign-in";
import { readControls, type SurfaceControl } from "@/lib/free-tools/surface-coverage";
import {
  OrganizationAiRateLimitError,
  readOrganizationAiAllowance,
  reserveOrganizationAiRequest,
} from "@/lib/operations/organization-ai-guard";
import { recordImportedDraft } from "@/lib/services/imported-drafts";
import { createTestCase } from "@/lib/services/test-cases";

/**
 * "Cover this page": plan the test cases one page needs, let a person keep the
 * ones they want, then prove each on the live page.
 *
 * Planning and proving are separate on purpose. The plan costs one AI request
 * and changes nothing; only what a person approves is spent on, and they see
 * the cost before they approve. Each approved item then becomes a draft Test
 * Case with Playwright code that was run on the page -- the same evidence as a
 * test brought in from Quick Generate -- and still goes through review.
 *
 * Proving happens one item per call, so no single request runs longer than a
 * server allows; the progress page asks for the next item until none are left.
 * An item is claimed by a conditional update, so two calls in parallel never
 * prove the same one.
 */

export const PAGE_COVERAGE_MAX_ITEMS = 6;
/** An item left "proving" this long was abandoned by a request that died. */
const STALE_PROVING_MS = 10 * 60_000;
/** A plan costs one request; each item costs one to write it and one per fix. */
const FIXES_PER_ITEM = 2;

export class PageCoverageError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "page_unreadable"
      | "not_found"
      | "not_plannable"
      | "nothing_selected"
      | "allowance_used"
      | "plan_failed"
      | "sign_in_needed",
    readonly detail?: string,
  ) {
    super(code);
    this.name = "PageCoverageError";
  }
}

type Dependencies = WorkspaceContextDependencies;

function client(dependencies?: Dependencies): PrismaClient {
  return dependencies?.prisma ?? getPrismaClient();
}

async function workspaceFor(input: { orgSlug?: string; projectId: string }, dependencies?: Dependencies) {
  const projectId = z.string().uuid().parse(input.projectId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "testcase:create" },
    dependencies,
  );
  return { workspace, projectId };
}

async function reserve(organizationId: string) {
  try {
    return await reserveOrganizationAiRequest({ organizationId, surface: "page-coverage" });
  } catch (error) {
    if (error instanceof OrganizationAiRateLimitError) {
      throw new PageCoverageError(
        "allowance_used",
        error.code === "organization_burst_limit"
          ? "Too many AI requests in a minute; it carries on in a moment."
          : "The workspace has used today's AI allowance. It resets at midnight UTC; the Team plan raises it.",
      );
    }
    throw error;
  }
}

/**
 * Starts planning the test cases a page needs, and returns at once.
 *
 * Reading a page and planning take about a minute -- long enough for the
 * sign-in session to lapse inside a single request, which showed the person a
 * sign-in screen instead of their plan. So the plan is recorded straight away
 * as PLANNING, the reading and planning run in `schedule` (the page passes
 * Next's `after`), and the plan page refreshes until it is ready.
 *
 * The one AI request is reserved before anything else, so running out of the
 * daily allowance is said at once rather than after a minute's wait. A test
 * account, when given, lives only in this call and the scheduled task.
 */
export async function startPageCoveragePlan(
  input: {
    orgSlug?: string;
    projectId: string;
    pageUrl: string;
    focus?: string;
    /** A test account for a page behind a login. Used to read the page; never stored. */
    account?: TestAccount | null;
  },
  schedule: (task: () => Promise<void>) => void = (task) => void task(),
  dependencies?: Dependencies,
  plan: typeof planPageCoverage = planPageCoverage,
) {
  const { workspace, projectId } = await workspaceFor(input, dependencies);
  const pageUrl = input.pageUrl.trim();
  if (!isPublicWebAddress(pageUrl)) throw new PageCoverageError("invalid_input", "Use a public web address.");
  const focus = (input.focus ?? "").trim().slice(0, 2_000);
  const account = input.account ? testAccountSchema.parse(input.account) : null;

  await reserve(workspace.organization.id);
  const run = await client(dependencies).pageCoverage.create({
    data: {
      organizationId: workspace.organization.id,
      projectId,
      pageUrl,
      pageTitle: pageUrl.slice(0, 300),
      focus,
      needsSignIn: Boolean(account),
      status: "PLANNING",
      controls: [] as unknown as Prisma.InputJsonValue,
      createdByUserId: workspace.user.id,
    },
    select: { id: true },
  });

  schedule(async () => {
    try {
      await completePageCoveragePlan(
        { runId: run.id, organizationId: workspace.organization.id, projectId, pageUrl, focus, account },
        dependencies,
        plan,
      );
    } catch (error) {
      console.error("[page-coverage] planning failed", error);
      await client(dependencies)
        .pageCoverage.update({
          where: { id: run.id },
          data: { status: "PLAN_FAILED", message: "A plan could not be made for this page. Try again, or say what you want covered." },
        })
        .catch(() => {});
    }
  });
  return run;
}

/** The slow half of planning: read the page, ask for the plan, store it. */
async function completePageCoveragePlan(
  input: {
    runId: string;
    organizationId: string;
    projectId: string;
    pageUrl: string;
    focus: string;
    account: TestAccount | null;
  },
  dependencies: Dependencies | undefined,
  plan: typeof planPageCoverage,
) {
  const prisma = client(dependencies);
  const failed = (message: string) =>
    prisma.pageCoverage.update({ where: { id: input.runId }, data: { status: "PLAN_FAILED", message } });

  const snapshot = await capturePageSnapshot(input.pageUrl, input.account ? { account: input.account } : {});
  if (!snapshot.ok) {
    await failed(
      snapshot.reason === "sign_in_rejected"
        ? "The site did not accept the test account."
        : snapshot.reason === "no_login_form"
          ? "No sign-in form was found on that page. Check the address, or add the login page's address."
          : "The page could not be opened. Check the address, or try again in a moment.",
    );
    return;
  }

  const existing = await prisma.testCase.findMany({
    where: { organizationId: input.organizationId, projectId: input.projectId, status: { not: "ARCHIVED" } },
    select: { title: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const proposed: PageCoveragePlan = await plan({
    pageUrl: snapshot.finalUrl,
    title: snapshot.title,
    aria: snapshot.aria,
    elementHints: snapshot.elementHints,
    focus: input.focus,
    existingTitles: existing.map((row) => row.title),
    maxItems: PAGE_COVERAGE_MAX_ITEMS,
  });
  if (proposed.items.length === 0) {
    await failed("Every test this page needs is already in the project.");
    return;
  }

  const controls = withTestIds(readControls(snapshot.aria), snapshot.elementHints);
  await prisma.$transaction([
    prisma.pageCoverageItem.createMany({
      data: proposed.items.map((item, position) => ({
        pageCoverageId: input.runId,
        position,
        title: item.title,
        objective: item.objective,
        steps: item.steps,
        expectedResults: item.expectedResults,
        priority: item.priority,
        rationale: item.rationale,
      })),
    }),
    prisma.pageCoverage.update({
      where: { id: input.runId },
      data: {
        status: "PLANNED",
        // Behind a login, proving starts where the person started, so it signs
        // in on the way; otherwise the page as it finally loaded.
        pageUrl: input.account ? input.pageUrl : snapshot.finalUrl,
        pageTitle: snapshot.title.slice(0, 300) || snapshot.finalUrl.slice(0, 300),
        message: [proposed.summary, ...proposed.outOfScope.map((item) => `Left out: ${item}`)].join("\n").slice(0, 5_000),
        controls: controls as unknown as Prisma.InputJsonValue,
      },
    }),
  ]);
}

/** Keeps the chosen items and starts proving them. Spends nothing itself. */
export async function approvePageCoverage(
  input: { orgSlug?: string; projectId: string; coverageId: string; itemIds: string[] },
  dependencies?: Dependencies,
) {
  const { workspace, projectId } = await workspaceFor(input, dependencies);
  const coverageId = z.string().uuid().parse(input.coverageId);
  const itemIds = z.array(z.string().uuid()).max(PAGE_COVERAGE_MAX_ITEMS * 2).parse(input.itemIds);
  if (itemIds.length === 0) throw new PageCoverageError("nothing_selected");

  return client(dependencies).$transaction(async (transaction) => {
    const run = await transaction.pageCoverage.findUnique({
      where: { organizationId_projectId_id: { organizationId: workspace.organization.id, projectId, id: coverageId } },
      select: { id: true, status: true },
    });
    if (!run) throw new PageCoverageError("not_found");
    if (run.status !== "PLANNED") throw new PageCoverageError("not_plannable");
    const queued = await transaction.pageCoverageItem.updateMany({
      where: { pageCoverageId: run.id, id: { in: itemIds }, status: "PROPOSED" },
      data: { status: "QUEUED" },
    });
    if (queued.count === 0) throw new PageCoverageError("nothing_selected");
    await transaction.pageCoverageItem.updateMany({
      where: { pageCoverageId: run.id, status: "PROPOSED" },
      data: { status: "SKIPPED" },
    });
    await transaction.pageCoverage.update({ where: { id: run.id }, data: { status: "PROVING", message: null } });
    return { queued: queued.count };
  });
}

/** Picks up a paused run (after the daily allowance reset, for example). */
export async function resumePageCoverage(
  input: { orgSlug?: string; projectId: string; coverageId: string },
  dependencies?: Dependencies,
) {
  const { workspace, projectId } = await workspaceFor(input, dependencies);
  const coverageId = z.string().uuid().parse(input.coverageId);
  const updated = await client(dependencies).pageCoverage.updateMany({
    where: { id: coverageId, organizationId: workspace.organization.id, projectId, status: "PAUSED" },
    data: { status: "PROVING", message: null },
  });
  if (updated.count === 0) throw new PageCoverageError("not_found");
}

function requestFor(item: { title: string; objective: string; steps: Prisma.JsonValue; expectedResults: Prisma.JsonValue }) {
  const list = (value: Prisma.JsonValue) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
  return [
    item.title,
    item.objective,
    "Steps:",
    ...list(item.steps).map((step, index) => `${index + 1}. ${step}`),
    "Expected:",
    ...list(item.expectedResults).map((result) => `- ${result}`),
  ].join("\n");
}

type ProveOutcomeSummary = { status: "PASSED" | "PARTIAL" | "FAILED" | "ERROR"; checks: number; fixes: number; detail: string };

/**
 * Proves the next queued item: creates its draft Test Case, writes the test from
 * the live page, runs it, fixes a failing step, runs again, and keeps the code
 * with its run evidence on the Test Case. Returns what is left to do.
 */
export async function proveNextPageCoverageItem(
  input: { orgSlug?: string; projectId: string; coverageId: string; account?: TestAccount | null },
  dependencies?: Dependencies,
): Promise<{ provedItemId: string | null; remaining: number; status: string }> {
  const { workspace, projectId } = await workspaceFor(input, dependencies);
  const coverageId = z.string().uuid().parse(input.coverageId);
  const prisma = client(dependencies);

  const run = await prisma.pageCoverage.findUnique({
    where: { organizationId_projectId_id: { organizationId: workspace.organization.id, projectId, id: coverageId } },
  });
  if (!run) throw new PageCoverageError("not_found");

  const counts = async () =>
    prisma.pageCoverageItem.count({ where: { pageCoverageId: run.id, status: { in: ["QUEUED", "PROVING"] } } });
  if (run.status !== "PROVING") return { provedItemId: null, remaining: await counts(), status: run.status };
  const account = input.account ? testAccountSchema.parse(input.account) : null;
  if (run.needsSignIn && !account) throw new PageCoverageError("sign_in_needed");
  // The account's values for the process.env names generated sign-in steps use.
  const env = account ? { E2E_USERNAME: account.username, E2E_PASSWORD: account.password } : undefined;

  // A request that died mid-item leaves it "proving" forever; hand it back.
  await prisma.pageCoverageItem.updateMany({
    where: { pageCoverageId: run.id, status: "PROVING", startedAt: { lt: new Date(Date.now() - STALE_PROVING_MS) } },
    data: { status: "QUEUED", startedAt: null },
  });

  const next = await prisma.pageCoverageItem.findFirst({
    where: { pageCoverageId: run.id, status: "QUEUED" },
    orderBy: { position: "asc" },
  });
  if (!next) {
    const left = await counts();
    if (left === 0) await prisma.pageCoverage.update({ where: { id: run.id }, data: { status: "DONE" } });
    return { provedItemId: null, remaining: left, status: left === 0 ? "DONE" : run.status };
  }
  const claimed = await prisma.pageCoverageItem.updateMany({
    where: { id: next.id, status: "QUEUED" },
    data: { status: "PROVING", startedAt: new Date() },
  });
  if (claimed.count === 0) return { provedItemId: null, remaining: await counts(), status: run.status };

  // Writing the test is the first request this item spends.
  try {
    await reserve(workspace.organization.id);
  } catch (error) {
    await prisma.pageCoverageItem.update({ where: { id: next.id }, data: { status: "QUEUED", startedAt: null } });
    if (error instanceof PageCoverageError && error.code === "allowance_used") {
      await prisma.pageCoverage.update({ where: { id: run.id }, data: { status: "PAUSED", message: error.detail } });
      return { provedItemId: null, remaining: await counts(), status: "PAUSED" };
    }
    throw error;
  }

  const steps = Array.isArray(next.steps) ? next.steps.filter((entry): entry is string => typeof entry === "string") : [];
  const expected = Array.isArray(next.expectedResults)
    ? next.expectedResults.filter((entry): entry is string => typeof entry === "string")
    : [];

  let summary: ProveOutcomeSummary;
  let code: string | null = null;
  let receipt: string | null = null;
  let testCaseId: string | null = null;
  try {
    const testCase = await createTestCase(
      {
        orgSlug: input.orgSlug,
        projectId,
        title: next.title,
        objective: next.objective,
        steps,
        expectedResults: expected,
        priority: next.priority,
        type: "END_TO_END",
        source: "AI_SUGGESTED",
        tags: ["page-coverage"],
        automationStatus: "CANDIDATE",
      },
      dependencies,
    );
    testCaseId = testCase.id;

    let runPageUrl = run.pageUrl;
    let pageTreeAtStart: string | undefined;
    const outcome = await proveDraftOnLivePage(
      {
        report: () => {},
        generate: async () => {
          const snapshot = await capturePageSnapshot(run.pageUrl, account ? { account } : {});
          if (snapshot.ok) {
            // A signed-in page is reached through the login, so the run starts
            // where the login does and signs in with the account's values.
            runPageUrl = account ? run.pageUrl : snapshot.finalUrl;
            pageTreeAtStart = snapshot.aria.slice(0, 4_000);
          }
          const draft = await generateQuickDraft({
            mode: "FLOW",
            request: requestFor(next),
            pageUrl: run.pageUrl,
            depth: "FOCUSED",
            fileContext: "",
            imageDataUrls: [],
            pageSnapshot: snapshot.ok ? snapshot : null,
          });
          return { ok: true as const, code: draft.code, title: draft.title, payload: null };
        },
        run: async (current) => {
          const prepared = prepareLiveRun({ code: current, pageUrl: runPageUrl, env });
          if (!prepared.ok) return { ok: false as const, limit: false, message: prepared.error };
          const { result, receipt: signed } = await executeLiveRun(prepared.run);
          return {
            ok: true as const,
            verdict: runVerdict(result),
            passed: result.counts.passed,
            failed: result.counts.failed,
            skipped: result.counts.skipped + result.counts.notReached,
            receipt: signed,
            failure: firstFailureOf(result),
            payload: result,
          };
        },
        fix: async (current, failure) => {
          try {
            await reserve(workspace.organization.id);
          } catch (error) {
            if (error instanceof PageCoverageError) return { ok: false as const, limit: true, message: error.detail ?? "" };
            throw error;
          }
          const repaired = await repairDraft({
            code: current,
            pageUrl: runPageUrl,
            failure: { step: failure.step, line: failure.line, reason: failure.reason },
            pageTreeAtFailure: failure.pageTree,
            ...(pageTreeAtStart ? { pageTreeAtStart } : {}),
            ...(failure.skippedEarlier.length ? { skippedEarlier: failure.skippedEarlier } : {}),
          });
          return { ok: true as const, code: repaired.code, explanation: repaired.explanation, payload: null };
        },
      },
      { maxFixes: FIXES_PER_ITEM },
    );

    code = outcome.code;
    receipt = outcome.verdict === "failed" ? null : outcome.receipt;
    const lastRun = outcome.lastRun as { counts?: { passed: number } } | null;
    const checks = lastRun?.counts?.passed ?? 0;
    summary = outcome.verdict === "passed"
      ? { status: "PASSED", checks, fixes: outcome.fixesUsed, detail: `Passed on the live page: ${checks} checks.` }
      : outcome.verdict === "partial"
        ? { status: "PARTIAL", checks, fixes: outcome.fixesUsed, detail: "Nothing failed, but some steps could not run in the preview." }
        : outcome.verdict === "failed"
          ? { status: "FAILED", checks, fixes: outcome.fixesUsed, detail: outcome.stopped === "limit" ? "Stopped when the AI allowance ran out." : "Still failing after the automatic fixes; the code is kept for a person to finish." }
          : { status: "ERROR", checks: 0, fixes: 0, detail: outcome.message ?? "It could not be run." };
  } catch (error) {
    console.error("[page-coverage] proving an item failed", error);
    summary = { status: "ERROR", checks: 0, fixes: 0, detail: "Something went wrong while proving this test." };
  }

  // The code goes with the Test Case, with its run evidence when it did not fail.
  if (testCaseId && code) {
    await recordImportedDraft(
      {
        organizationId: workspace.organization.id,
        projectId,
        testCaseId,
        userId: workspace.user.id,
        source: "page-coverage",
        code,
        pageUrl: run.pageUrl,
        receipt,
      },
      prisma,
    ).catch((error: unknown) => console.error("[page-coverage] could not keep the code", error));
  }

  await prisma.pageCoverageItem.update({
    where: { id: next.id },
    data: {
      status: summary.status,
      testCaseId,
      code,
      checks: summary.checks,
      fixes: summary.fixes,
      detail: summary.detail,
      finishedAt: new Date(),
    },
  });
  const remaining = await counts();
  if (remaining === 0) await prisma.pageCoverage.update({ where: { id: run.id }, data: { status: "DONE" } });
  return { provedItemId: next.id, remaining, status: remaining === 0 ? "DONE" : "PROVING" };
}

/**
 * Every proven test in one runnable spec file. Each test file's body is wrapped
 * in its own describe block, so helper constants two files both declared (a
 * BASE_URL, a TODO_TEXT) stay separate instead of colliding.
 */
export function buildSuite(
  pageUrl: string,
  items: Array<{ title: string; status: string; code: string | null }>,
) {
  const proven = items.filter((item) => (item.status === "PASSED" || item.status === "PARTIAL") && item.code);
  if (proven.length === 0) return null;
  const importLine = /^\s*import\s+\{[^}]*\}\s+from\s+["']@playwright\/test["'];?\s*$/gm;
  const blocks = proven.map((item) => {
    const body = (item.code ?? "").replace(importLine, "").trim();
    const indented = body.split("\n").map((line) => (line ? `  ${line}` : line)).join("\n");
    return `// ${item.status === "PASSED" ? "Passed" : "Partly run"} on the live page.\ntest.describe(${JSON.stringify(item.title)}, () => {\n${indented}\n});`;
  });
  return [
    `// Generated and proven by PlaywrightGen against ${pageUrl}`,
    "// Set baseURL in playwright.config.ts to the site these tests should run against.",
    "import { test, expect } from '@playwright/test';",
    "",
    blocks.join("\n\n"),
    "",
  ].join("\n");
}

export type CoverageControl = SurfaceControl & { testIds?: string[] };

const HINT_LINE = /^([a-z]+) "((?:[^"\\]|\\.)*)" \[(data-[a-z-]+)="([^"]*)"\]$/;

/**
 * Attaches each control's test attribute values (from the page's element
 * hints), so a test that clicks "Add to cart" through
 * [data-test="add-to-cart-backpack"] still counts as reaching it.
 */
export function withTestIds(controls: SurfaceControl[], hints: string[]): CoverageControl[] {
  const byControl = new Map<string, string[]>();
  for (const line of hints) {
    const match = line.match(HINT_LINE);
    if (!match) continue;
    const key = `${match[1]}|${normalizeName(match[2])}`;
    byControl.set(key, [...(byControl.get(key) ?? []), match[4]]);
  }
  return controls.map((control) => {
    const testIds = byControl.get(`${control.role}|${normalizeName(control.name)}`);
    return testIds?.length ? { ...control, testIds } : control;
  });
}

/**
 * Which of the page's named controls the proven tests reach: by accessible
 * name, or by one of the control's test attribute values.
 */
export function measureControls(controls: CoverageControl[], code: string) {
  const targeted = new Set(extractLocatorNames(code).map(normalizeName));
  const isReached = (control: CoverageControl) =>
    targeted.has(normalizeName(control.name)) ||
    (control.testIds ?? []).some((id) => code.includes(`"${id}"`) || code.includes(`'${id}'`));
  return {
    total: controls.length,
    reached: controls.filter(isReached).map(({ role, name }) => ({ role, name })),
    missed: controls.filter((control) => !isReached(control)).map(({ role, name }) => ({ role, name })),
  };
}

function readControlsJson(value: Prisma.JsonValue): CoverageControl[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    if (typeof entry.role !== "string" || typeof entry.name !== "string") return [];
    const testIds = Array.isArray(entry.testIds) ? entry.testIds.filter((id): id is string => typeof id === "string") : [];
    return [{ role: entry.role, name: entry.name, ...(testIds.length ? { testIds } : {}) }];
  });
}

export async function getPageCoverage(
  input: { orgSlug?: string; projectId: string; coverageId: string },
  dependencies?: Dependencies,
) {
  const projectId = z.string().uuid().parse(input.projectId);
  const coverageId = z.string().uuid().parse(input.coverageId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "testcase:read" },
    dependencies,
  );
  const run = await client(dependencies).pageCoverage.findUnique({
    where: { organizationId_projectId_id: { organizationId: workspace.organization.id, projectId, id: coverageId } },
    include: { items: { orderBy: { position: "asc" } }, createdBy: { select: { displayName: true } } },
  });
  if (!run) throw new PageCoverageError("not_found");
  const controls = readControlsJson(run.controls);
  const provenCode = run.items
    .filter((item) => item.status === "PASSED" || item.status === "PARTIAL")
    .map((item) => item.code ?? "")
    .join("\n");
  // What proving will cost, against what is actually left today: finding out
  // by being refused halfway through a plan is the worst way to learn it.
  const allowance = await readOrganizationAiAllowance({ organizationId: workspace.organization.id }).catch(
    (error: unknown) => {
      console.error("[page-coverage] could not read the allowance", error);
      return null;
    },
  );
  return {
    run,
    coverage: measureControls(controls, provenCode),
    suite: buildSuite(run.pageUrl, run.items),
    canAct: workspace.can("testcase:create"),
    /** Most the proving can cost: one request per item, plus its fixes. */
    costPerItem: 1 + FIXES_PER_ITEM,
    allowance,
  };
}

export async function listPageCoverages(
  input: { orgSlug?: string; projectId: string },
  dependencies?: Dependencies,
) {
  const projectId = z.string().uuid().parse(input.projectId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "testcase:read" },
    dependencies,
  );
  return client(dependencies).pageCoverage.findMany({
    where: { organizationId: workspace.organization.id, projectId },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { items: { select: { status: true } } },
  });
}
