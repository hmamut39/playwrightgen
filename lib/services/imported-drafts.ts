import "server-only";

import { z } from "zod";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { validateQuickGeneration } from "@/lib/ai/quick-generation";
import { getPrismaClient } from "@/lib/db/prisma";
import {
  readRunReceiptSecret,
  runReceiptSchema,
  verifyRunReceipt,
  type RunReceipt,
} from "@/lib/free-tools/preview-run/receipt";

/**
 * Playwright code that arrives with a Test Case from a free tool.
 *
 * Someone who got a draft passing on the live page should not have to throw
 * the code away and generate it again once the Test Case is approved. The code
 * is kept with the Test Case -- untrusted, outside automation -- and can seed
 * the first automation version later, which is then reviewed like any other.
 *
 * Whether it passed is recorded only from a signed run receipt that matches
 * the code exactly; a claim the browser makes on its own is not evidence.
 */

export type ImportedRunEvidence = RunReceipt;

/** Where imported code came from, as a person would say it. */
export function importedDraftSourceLabel(source: string) {
  if (source === "editor") return "an editor AI assistant";
  if (source === "coverage-review") return "Coverage Review";
  if (source === "page-coverage") return "Cover a page";
  return "Quick Generate";
}

export class ImportedDraftError extends Error {
  constructor(readonly code: "test_case_not_found" | "test_case_archived" | "invalid_playwright_code", readonly detail?: string) {
    super(code);
    this.name = "ImportedDraftError";
  }
}

/**
 * Code an editor's AI assistant wrote for a Test Case, sent over MCP.
 *
 * It takes the same place as code brought from Quick Generate: kept with the
 * Test Case, unreviewed, until a person turns it into an automation version.
 * Sending new code replaces code not yet used; after it was used, it starts the
 * next version. It carries run evidence only with a signed receipt from a live
 * run of this exact code.
 */
export async function attachEditorCode(
  input: {
    orgSlug?: string;
    projectId: string;
    testCaseId: string;
    code: string;
    runReceipt?: string | null;
    /** Which assistant sent this code, when it said who it was. */
    authoredByAgent?: string | null;
  },
  dependencies?: WorkspaceContextDependencies,
  secret: string | null = readRunReceiptSecret(),
) {
  const projectId = z.string().uuid().parse(input.projectId);
  const testCaseId = z.string().uuid().parse(input.testCaseId);
  const code = z.string().min(1).max(100_000).parse(input.code);
  const validation = validateQuickGeneration(code);
  if (validation.status === "BLOCKED") {
    throw new ImportedDraftError(
      "invalid_playwright_code",
      validation.findings.filter((finding) => finding.severity === "BLOCKING").map((finding) => finding.message).join(" "),
    );
  }
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "testcase:update" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();
  const testCase = await prisma.testCase.findUnique({
    where: { organizationId_projectId_id: { organizationId: workspace.organization.id, projectId, id: testCaseId } },
    select: { status: true },
  });
  if (!testCase) throw new ImportedDraftError("test_case_not_found");
  if (testCase.status === "ARCHIVED") throw new ImportedDraftError("test_case_archived");

  const key = { organizationId_projectId_testCaseId: { organizationId: workspace.organization.id, projectId, testCaseId } };
  // A receipt from run_playwright_test counts only for this exact code.
  const evidence = input.runReceipt && secret ? verifyRunReceipt(input.runReceipt, code, secret) : null;
  const fields = {
    source: "editor",
    authoredByAgent: input.authoredByAgent?.slice(0, 120) || null,
    code,
    pageUrl: evidence?.pageUrl ?? null,
    runEvidence: evidence ? (evidence as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
    importedByUserId: workspace.user.id,
    usedAt: null,
    usedInAutomationVersionId: null,
  };
  await prisma.testCaseImportedDraft.upsert({
    where: key,
    create: { organizationId: workspace.organization.id, projectId, testCaseId, ...fields },
    update: fields,
  });
  return {
    testCaseStatus: testCase.status,
    warnings: validation.findings.map((finding) => finding.message),
    evidence,
  };
}

export function readRunEvidence(value: Prisma.JsonValue | null): ImportedRunEvidence | null {
  const parsed = runReceiptSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function recordImportedDraft(
  input: {
    organizationId: string;
    projectId: string;
    testCaseId: string;
    userId: string;
    source: string;
    code: string;
    pageUrl?: string | null;
    receipt?: string | null;
  },
  prisma: PrismaClient = getPrismaClient(),
  secret: string | null = readRunReceiptSecret(),
) {
  const evidence = input.receipt && secret ? verifyRunReceipt(input.receipt, input.code, secret) : null;
  return prisma.testCaseImportedDraft.create({
    data: {
      organizationId: input.organizationId,
      projectId: input.projectId,
      testCaseId: input.testCaseId,
      importedByUserId: input.userId,
      source: input.source,
      code: input.code,
      pageUrl: input.pageUrl || null,
      runEvidence: (evidence ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function getImportedDraft(
  input: { orgSlug?: string; projectId: string; testCaseId: string },
  dependencies?: WorkspaceContextDependencies,
) {
  const projectId = z.string().uuid().parse(input.projectId);
  const testCaseId = z.string().uuid().parse(input.testCaseId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "testcase:read" },
    dependencies,
  );
  const draft = await (dependencies?.prisma ?? getPrismaClient()).testCaseImportedDraft.findUnique({
    where: {
      organizationId_projectId_testCaseId: {
        organizationId: workspace.organization.id,
        projectId,
        testCaseId,
      },
    },
  });
  if (!draft) return null;
  return {
    id: draft.id,
    source: draft.source,
    code: draft.code,
    pageUrl: draft.pageUrl,
    evidence: readRunEvidence(draft.runEvidence),
    usedInAutomationVersionId: draft.usedInAutomationVersionId,
    usedAt: draft.usedAt,
    createdAt: draft.createdAt,
  };
}
