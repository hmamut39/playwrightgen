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
import { readControls, type SurfaceControl } from "@/lib/free-tools/surface-coverage";
import {
  OrganizationAiRateLimitError,
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
      | "plan_failed",
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

/** Plans the test cases a page needs. Costs one AI request; creates nothing but the plan. */
export async function planPageCoverageRun(
  input: { orgSlug?: string; projectId: string; pageUrl: string; focus?: string },
  dependencies?: Dependencies,
  plan: typeof planPageCoverage = planPageCoverage,
) {
  const { workspace, projectId } = await workspaceFor(input, dependencies);
  const pageUrl = input.pageUrl.trim();
  if (!isPublicWebAddress(pageUrl)) throw new PageCoverageError("invalid_input", "Use a public web address.");
  const focus = (input.focus ?? "").trim().slice(0, 2_000);

  await reserve(workspace.organization.id);
  const snapshot = await capturePageSnapshot(pageUrl);
  if (!snapshot.ok) throw new PageCoverageError("page_unreadable", snapshot.reason);

  const existing = await client(dependencies).testCase.findMany({
    where: { organizationId: workspace.organization.id, projectId, status: { not: "ARCHIVED" } },
    select: { title: true },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  let proposed: PageCoveragePlan;
  try {
    proposed = await plan({
      pageUrl: snapshot.finalUrl,
      title: snapshot.title,
      aria: snapshot.aria,
      elementHints: snapshot.elementHints,
      focus,
      existingTitles: existing.map((row) => row.title),
      maxItems: PAGE_COVERAGE_MAX_ITEMS,
    });
  } catch (error) {
    console.error("[page-coverage] planning failed", error);
    throw new PageCoverageError("plan_failed");
  }
  if (proposed.items.length === 0) {
    throw new PageCoverageError("plan_failed", "Every test this page needs is already in the project.");
  }

  const controls: SurfaceControl[] = readControls(snapshot.aria);
  const run = await client(dependencies).pageCoverage.create({
    data: {
      organizationId: workspace.organization.id,
      projectId,
      pageUrl: snapshot.finalUrl,
      pageTitle: snapshot.title.slice(0, 300) || snapshot.finalUrl.slice(0, 300),
      focus,
      message: [proposed.summary, ...proposed.outOfScope.map((item) => `Left out: ${item}`)].join("\n").slice(0, 5_000),
      controls: controls as unknown as Prisma.InputJsonValue,
      createdByUserId: workspace.user.id,
      items: {
        create: proposed.items.map((item, position) => ({
          position,
          title: item.title,
          objective: item.objective,
          steps: item.steps,
          expectedResults: item.expectedResults,
          priority: item.priority,
          rationale: item.rationale,
        })),
      },
    },
    select: { id: true },
  });
  return run;
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
  input: { orgSlug?: string; projectId: string; coverageId: string },
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
          const snapshot = await capturePageSnapshot(run.pageUrl);
          if (snapshot.ok) {
            runPageUrl = snapshot.finalUrl;
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
          const prepared = prepareLiveRun({ code: current, pageUrl: runPageUrl });
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

/** Which of the page's named controls the proven tests reach, by name. */
export function measureControls(controls: SurfaceControl[], code: string) {
  const targeted = new Set(extractLocatorNames(code).map(normalizeName));
  const reached = controls.filter((control) => targeted.has(normalizeName(control.name)));
  return {
    total: controls.length,
    reached,
    missed: controls.filter((control) => !targeted.has(normalizeName(control.name))),
  };
}

function readControlsJson(value: Prisma.JsonValue): SurfaceControl[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.role === "string" && typeof entry.name === "string"
      ? [{ role: entry.role, name: entry.name }]
      : [],
  );
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
  return {
    run,
    coverage: measureControls(controls, provenCode),
    canAct: workspace.can("testcase:create"),
    /** Most the proving can cost: one request per item, plus its fixes. */
    costPerItem: 1 + FIXES_PER_ITEM,
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
