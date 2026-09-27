import "server-only";

import { z } from "zod";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";

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
