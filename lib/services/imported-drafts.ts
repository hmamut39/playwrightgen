import "server-only";

import { z } from "zod";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
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
