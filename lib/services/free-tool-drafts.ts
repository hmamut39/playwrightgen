import "server-only";

import { z } from "zod";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import type { RunReceipt } from "@/lib/free-tools/preview-run/receipt";

/**
 * A signed-in person's own recent free-tool results.
 *
 * A draft that took a minute to generate and two runs to get passing used to
 * vanish with the browser tab. Keeping the latest few, with the code as it
 * last ran and that run's outcome, lets someone come back to it tomorrow or
 * send it to a project later. Every read and write is scoped by the Clerk user
 * id the route got from the session, never by anything the browser sends.
 */

export const FREE_TOOL_DRAFT_LIMIT = 20;

const idSchema = z.string().uuid();

/** The outcome of the last live run, with its signed receipt so evidence survives a reload. */
export type StoredRun = Pick<RunReceipt, "verdict" | "passed" | "failed" | "skipped" | "notReached" | "ranAt" | "pageUrl"> & {
  receipt: string | null;
};

function client(prisma?: PrismaClient) {
  return prisma ?? getPrismaClient();
}

export async function saveFreeToolDraft(
  input: {
    clerkUserId: string;
    source: "quick-generate" | "coverage-review";
    title: string;
    pageUrl?: string | null;
    code: string;
    payload: Prisma.InputJsonValue;
  },
  prisma?: PrismaClient,
): Promise<string> {
  const draft = await client(prisma).freeToolDraft.create({
    data: {
      clerkUserId: input.clerkUserId,
      source: input.source,
      title: input.title.slice(0, 300),
      pageUrl: input.pageUrl || null,
      code: input.code,
      payload: input.payload,
    },
    select: { id: true },
  });
  const older = await client(prisma).freeToolDraft.findMany({
    where: { clerkUserId: input.clerkUserId },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip: FREE_TOOL_DRAFT_LIMIT,
    select: { id: true },
  });
  if (older.length) {
    await client(prisma).freeToolDraft.deleteMany({
      where: { clerkUserId: input.clerkUserId, id: { in: older.map((row) => row.id) } },
    });
  }
  return draft.id;
}

/** Records what ran and how it went. Returns false when the draft is not this person's. */
export async function recordFreeToolDraftRun(
  input: { clerkUserId: string; draftId: string; code: string; run: StoredRun },
  prisma?: PrismaClient,
): Promise<boolean> {
  const id = idSchema.safeParse(input.draftId);
  if (!id.success) return false;
  const updated = await client(prisma).freeToolDraft.updateMany({
    where: { id: id.data, clerkUserId: input.clerkUserId },
    data: { code: input.code, lastRun: input.run as unknown as Prisma.InputJsonValue },
  });
  return updated.count === 1;
}

/** Keeps a fixed draft's code; its run is cleared because it described other code. */
export async function recordFreeToolDraftCode(
  input: { clerkUserId: string; draftId: string; code: string },
  prisma?: PrismaClient,
): Promise<boolean> {
  const id = idSchema.safeParse(input.draftId);
  if (!id.success) return false;
  const updated = await client(prisma).freeToolDraft.updateMany({
    where: { id: id.data, clerkUserId: input.clerkUserId },
    data: { code: input.code, lastRun: Prisma.DbNull },
  });
  return updated.count === 1;
}

export function readStoredRun(value: Prisma.JsonValue | null): StoredRun | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const run = value as Record<string, unknown>;
  if (run.verdict !== "passed" && run.verdict !== "partial" && run.verdict !== "failed") return null;
  if (typeof run.passed !== "number" || typeof run.ranAt !== "string") return null;
  return {
    verdict: run.verdict,
    passed: run.passed,
    failed: typeof run.failed === "number" ? run.failed : 0,
    skipped: typeof run.skipped === "number" ? run.skipped : 0,
    notReached: typeof run.notReached === "number" ? run.notReached : 0,
    ranAt: run.ranAt,
    pageUrl: typeof run.pageUrl === "string" ? run.pageUrl : "",
    receipt: typeof run.receipt === "string" ? run.receipt : null,
  };
}

export async function listFreeToolDrafts(clerkUserId: string, prisma?: PrismaClient) {
  const rows = await client(prisma).freeToolDraft.findMany({
    where: { clerkUserId },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: FREE_TOOL_DRAFT_LIMIT,
    select: { id: true, source: true, title: true, pageUrl: true, lastRun: true, updatedAt: true },
  });
  return rows.map(({ lastRun, ...row }) => {
    const run = readStoredRun(lastRun);
    return { ...row, lastRun: run ? { verdict: run.verdict, passed: run.passed, ranAt: run.ranAt } : null };
  });
}

export async function getFreeToolDraft(clerkUserId: string, draftId: string, prisma?: PrismaClient) {
  const id = idSchema.safeParse(draftId);
  if (!id.success) return null;
  const draft = await client(prisma).freeToolDraft.findFirst({ where: { id: id.data, clerkUserId } });
  if (!draft) return null;
  return {
    id: draft.id,
    source: draft.source,
    title: draft.title,
    pageUrl: draft.pageUrl,
    code: draft.code,
    payload: draft.payload,
    lastRun: readStoredRun(draft.lastRun),
    updatedAt: draft.updatedAt,
  };
}

export async function deleteFreeToolDraft(clerkUserId: string, draftId: string, prisma?: PrismaClient) {
  const id = idSchema.safeParse(draftId);
  if (!id.success) return false;
  const deleted = await client(prisma).freeToolDraft.deleteMany({ where: { id: id.data, clerkUserId } });
  return deleted.count === 1;
}
