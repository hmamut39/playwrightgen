import "server-only";

import { z } from "zod";

import { activityDetail } from "@/lib/activity/detail";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { actionSummary } from "@/lib/services/activity-feed";
import { personName } from "@/lib/format/person-name";

/**
 * The activity trail as a file somebody can keep.
 *
 * The page answers "what happened yesterday". An audit asks "show me
 * everything that happened to this project last quarter", and paging through a
 * list twenty rows at a time is not an answer to that. The record was already
 * append-only and already the thing the evidence rests on; it simply could not
 * leave the screen.
 *
 * It exports what it read and says how much that was. A file that silently
 * stops at some limit would be worse than no file: a reviewer would believe
 * they were holding the whole trail.
 */

/**
 * Bounded on purpose. Once CI reports on every push an active project writes
 * thousands of rows a month, and an unbounded export is a request that times
 * out rather than a file.
 */
const MAX_ROWS = 5_000;

/** RFC 4180: quote anything that could be misread, and double inner quotes. */
function cell(value: string | null): string {
  const text = value ?? "";
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | null>>): string {
  // CRLF, because the readers this file is opened in are spreadsheets.
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

export type ActivityExport = {
  filename: string;
  csv: string;
  rowCount: number;
  /** True when older events exist beyond what this file holds. */
  capped: boolean;
};

export async function exportProjectActivity(
  input: { orgSlug?: string; projectId: string },
  dependencies?: WorkspaceContextDependencies,
): Promise<ActivityExport> {
  const projectId = z.string().uuid().parse(input.projectId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "project:read" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();

  const where = { organizationId: workspace.organization.id, projectId };
  const [rows, total, project] = await Promise.all([
    prisma.activity.findMany({
      where,
      include: { actor: { select: { displayName: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_ROWS,
    }),
    prisma.activity.count({ where }),
    prisma.project.findUniqueOrThrow({
      where: { organizationId_id: { organizationId: workspace.organization.id, id: projectId } },
      select: { slug: true },
    }),
  ]);

  const body = rows.map((row) => [
    row.createdAt.toISOString(),
    // The system acts for itself on CI deliveries and scheduled checks.
    row.actor?.displayName ? personName(row.actor.displayName) : "System",
    // The same phrase the page shows, so the file and the screen cannot be
    // read as two different records of one event.
    actionSummary[row.action],
    activityDetail(row.action, row.metadata),
    row.targetType,
    row.targetId,
  ]);

  const header = ["recorded_at_utc", "actor", "action", "detail", "target_type", "target_id"];

  // The covered range is in the name, so a reader holding the file can tell at
  // a glance what it does and does not cover.
  const newest = rows[0]?.createdAt.toISOString().slice(0, 10);
  const oldest = rows[rows.length - 1]?.createdAt.toISOString().slice(0, 10);
  const range = newest && oldest ? `-${oldest}-to-${newest}` : "";

  return {
    filename: `playwrightgen-activity-${project.slug}${range}.csv`,
    csv: toCsv([header, ...body]),
    rowCount: rows.length,
    capped: total > rows.length,
  };
}
