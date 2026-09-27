import "server-only";

import { z } from "zod";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { repairDraft } from "@/lib/ai/draft-repair";
import { getPrismaClient } from "@/lib/db/prisma";
import { executeLiveRun, prepareLiveRun } from "@/lib/free-tools/preview-run/run-draft";
import { runVerdict } from "@/lib/free-tools/preview-run/receipt";
import { proveDraftOnLivePage, type ProveFailure } from "@/lib/free-tools/prove-loop";
import { reserveOrganizationAiRequest } from "@/lib/operations/organization-ai-guard";
import { recordImportedDraft } from "@/lib/services/imported-drafts";

/**
 * Proposing a fix for a test that has started failing -- and refusing to,
 * when the test is not what is broken.
 *
 * "Can it fix the failing test?" is the first thing a team asks, and the
 * honest answer has a condition attached. A test fails for two quite
 * different reasons. The product changed and the test is right: the failure is
 * the whole point, and quietly repairing the test would delete the only
 * warning anybody was going to get. Or the test is wrong -- a renamed button,
 * a moved field, a timing assumption -- and repairing it is exactly the chore
 * worth automating.
 *
 * Failure analysis already tells them apart, with a category and a
 * confidence. So this asks it first and will not touch a test whose failure
 * looks like a product defect. A tool that hides bugs to keep a suite green is
 * worse than no tool, and a team whose customers are finding their bugs is
 * precisely the team that cannot afford one.
 *
 * What it produces is a proposal: repaired code with the record of the run
 * that proved it, kept beside the Test Case for a person to review and use.
 * It approves nothing, and it replaces no automation on its own.
 */

/** Categories that mean the test is at fault, so repairing it is honest. */
const TEST_AT_FAULT = new Set(["TEST_DEFECT", "FLAKY_TIMING"]);
/** Below this, the analysis is not sure enough to act on either way. */
const CONFIDENT_ENOUGH = 60;

export class AutomationRepairError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "no_live_url"
      | "no_failure"
      | "looks_like_product_defect"
      | "not_diagnosed"
      | "no_automation",
    readonly detail?: string,
  ) {
    super(code);
    this.name = "AutomationRepairError";
  }
}

export type RepairReadiness = {
  /** Whether a repair may be proposed at all. */
  allowed: boolean;
  /** The diagnosis this decision rests on, in the analysis's own words. */
  category: string | null;
  confidence: number | null;
  title: string | null;
  /** What to tell the person, whichever way it went. */
  message: string;
};

/**
 * Whether a repair should even be offered for this test case.
 *
 * Separate from doing it, because the answer belongs on the screen before
 * anybody presses anything: a person should see "this looks like a product
 * bug" instead of a button that quietly declines.
 */
export async function readRepairReadiness(
  input: { orgSlug?: string; projectId: string; testCaseId: string },
  dependencies?: WorkspaceContextDependencies,
): Promise<RepairReadiness> {
  const projectId = z.string().uuid().parse(input.projectId);
  const testCaseId = z.string().uuid().parse(input.testCaseId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "automation:generate" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();

  const finding = await prisma.failureFinding.findFirst({
    where: {
      organizationId: workspace.organization.id,
      projectId,
      attempt: { testRun: { testCaseId } },
    },
    orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
    select: { category: true, confidence: true, title: true },
  });

  if (!finding) {
    return {
      allowed: false,
      category: null,
      confidence: null,
      title: null,
      message:
        "Nothing has analysed this failure yet. Run the failure analysis first, so a repair is not proposed for a test that is doing its job.",
    };
  }
  if (finding.category === "PRODUCT_DEFECT" && finding.confidence >= CONFIDENT_ENOUGH) {
    return {
      allowed: false,
      category: finding.category,
      confidence: finding.confidence,
      title: finding.title,
      message:
        "This failure looks like a defect in the product, not in the test. Repairing the test here would delete the only warning anybody was going to get.",
    };
  }
  if (!TEST_AT_FAULT.has(finding.category) || finding.confidence < CONFIDENT_ENOUGH) {
    return {
      allowed: false,
      category: finding.category,
      confidence: finding.confidence,
      title: finding.title,
      message: `The analysis puts this down to ${finding.category.replace(/_/g, " ").toLowerCase()}${
        finding.confidence < CONFIDENT_ENOUGH ? ", and is not confident" : ""
      }. A repair is only offered when the test itself is what looks wrong.`,
    };
  }
  return {
    allowed: true,
    category: finding.category,
    confidence: finding.confidence,
    title: finding.title,
    message:
      "The analysis puts this down to the test rather than the product, so a repair can be proposed. A person still reviews it before it replaces anything.",
  };
}

/** The first failing step of a run, in the shape the repair prompt expects. */
function firstFailure(result: Awaited<ReturnType<typeof executeLiveRun>>["result"]): ProveFailure | null {
  for (const test of result.tests) {
    for (const step of test.steps) {
      for (const operation of step.operations) {
        if (operation.status === "failed") {
          return {
            step: step.name,
            line: operation.source,
            reason: operation.detail ?? "It did not pass.",
            pageTree: test.failureSnapshot ?? "",
            skippedEarlier: [],
          };
        }
      }
    }
  }
  return null;
}

export type RepairOutcome = {
  /** Whether the repaired code passed on the live page. */
  proved: boolean;
  fixesUsed: number;
  checks: number;
  message: string;
};

/**
 * Runs the approved automation against the live page and, if it fails for a
 * reason the analysis blamed on the test, repairs it and runs it again.
 *
 * It starts from the code that is already approved rather than writing a new
 * test, so nothing is spent unless a fix is actually needed, and what comes
 * back is recognisably the team's own test with one thing changed.
 *
 * The result is kept beside the Test Case as a proposal, with the record of
 * the run that proved it, exactly where code from covering a page lands. It
 * replaces no automation: a person reviews it and chooses to use it, which is
 * the same gate everything else here passes through.
 */
export async function proposeAutomationRepair(
  input: { orgSlug?: string; projectId: string; testCaseId: string },
  dependencies?: WorkspaceContextDependencies,
): Promise<RepairOutcome> {
  const projectId = z.string().uuid().parse(input.projectId);
  const testCaseId = z.string().uuid().parse(input.testCaseId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "automation:generate" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();

  // The gate first: never repair a test whose failure looks like a real bug.
  const readiness = await readRepairReadiness(input, dependencies);
  if (!readiness.allowed) throw new AutomationRepairError("looks_like_product_defect", readiness.message);

  const project = await prisma.project.findUnique({
    where: { organizationId_id: { organizationId: workspace.organization.id, id: projectId } },
    select: { liveUrl: true },
  });
  if (!project?.liveUrl) throw new AutomationRepairError("no_live_url");

  const artifact = await prisma.automationArtifact.findFirst({
    where: {
      organizationId: workspace.organization.id,
      projectId,
      testCaseId,
      status: { not: "ARCHIVED" },
      approvedVersionNumber: { not: null },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, approvedVersionNumber: true },
  });
  if (!artifact?.approvedVersionNumber) throw new AutomationRepairError("no_automation");
  const version = await prisma.automationArtifactVersion.findFirst({
    where: {
      organizationId: workspace.organization.id,
      projectId,
      automationArtifactId: artifact.id,
      versionNumber: artifact.approvedVersionNumber,
    },
    select: { code: true },
  });
  if (!version?.code) throw new AutomationRepairError("no_automation");

  const pageUrl = project.liveUrl;
  const outcome = await proveDraftOnLivePage(
    {
      report: () => {},
      // Not a new test: the one the team already approved, unchanged.
      generate: async () => ({ ok: true as const, code: version.code, title: "", payload: null }),
      run: async (current) => {
        const prepared = prepareLiveRun({ code: current, pageUrl });
        if (!prepared.ok) return { ok: false as const, limit: false, message: prepared.error };
        const { result, receipt } = await executeLiveRun(prepared.run);
        return {
          ok: true as const,
          verdict: runVerdict(result),
          passed: result.counts.passed,
          failed: result.counts.failed,
          skipped: result.counts.skipped + result.counts.notReached,
          receipt,
          failure: firstFailure(result),
          payload: result,
        };
      },
      fix: async (current, failure) => {
        // Only a fix costs a request; a run that passes spends nothing.
        await reserveOrganizationAiRequest({
          organizationId: workspace.organization.id,
          surface: "automation-repair",
        });
        const repaired = await repairDraft({
          code: current,
          pageUrl,
          failure: { step: failure.step, line: failure.line, reason: failure.reason },
          pageTreeAtFailure: failure.pageTree,
          ...(failure.skippedEarlier.length ? { skippedEarlier: failure.skippedEarlier } : {}),
        });
        return { ok: true as const, code: repaired.code, explanation: repaired.explanation, payload: null };
      },
    },
    { maxFixes: 2 },
  );

  const lastRun = outcome.lastRun as { counts?: { passed: number } } | null;
  const checks = lastRun?.counts?.passed ?? 0;
  if (outcome.verdict !== "passed" || !outcome.code) {
    return {
      proved: false,
      fixesUsed: outcome.fixesUsed,
      checks,
      message:
        outcome.verdict === "partial"
          ? "Nothing failed, but some steps could not run in the preview, so this is not proof. Nothing was proposed."
          : "It still failed after the automatic fixes, so nothing was proposed. The failure may not be the test after all.",
    };
  }

  // Proposed beside the Test Case with its run evidence, where code from
  // covering a page lands. It replaces no automation on its own.
  await recordImportedDraft(
    {
      organizationId: workspace.organization.id,
      projectId,
      testCaseId,
      userId: workspace.user.id,
      source: "repair",
      code: outcome.code,
      pageUrl,
      receipt: outcome.receipt,
    },
    prisma,
  );

  return {
    proved: true,
    fixesUsed: outcome.fixesUsed,
    checks,
    message: `Repaired and proved on the live page: ${checks} check${checks === 1 ? "" : "s"}, ${outcome.fixesUsed} fix${outcome.fixesUsed === 1 ? "" : "es"}. It is waiting beside this Test Case for you to review.`,
  };
}
