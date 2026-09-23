import "server-only";

import { z } from "zod";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";

const uuidSchema = z.string().uuid();
const RECENT_FAILURE_DAYS = 30;

type ProjectQualityDependencies = WorkspaceContextDependencies;

export type EvidenceFreshness = "FRESH" | "AGING" | "STALE" | "MISSING";

export type ProjectQualityIntelligence = {
  project: { id: string; name: string; slug: string };
  measuredAt: Date;
  counts: {
    approvedRequirements: number;
    requirementsWithApprovedTests: number;
    approvedTestCases: number;
    testCasesWithCurrentAutomation: number;
    recentAttempts: number;
    recentFailedAttempts: number;
    openFailureFindings: number;
  };
  evidence: {
    freshness: EvidenceFreshness;
    lastEvidenceAt: Date | null;
    ageDays: number | null;
    missing: string[];
  };
  gaps: {
    requirementsWithoutApprovedTests: Array<{
      id: string;
      title: string;
      updatedAt: Date;
      linkedTestCaseCount: number;
    }>;
    testCasesWithoutCurrentAutomation: Array<{
      id: string;
      title: string;
      currentVersionNumber: number;
      updatedAt: Date;
    }>;
    staleAutomation: Array<{
      id: string;
      name: string;
      engine: "PLAYWRIGHT_BROWSER" | "PLAYWRIGHT_API";
      testCaseId: string;
      testCaseTitle: string;
      automatedVersionNumber: number;
      currentVersionNumber: number;
      updatedAt: Date;
    }>;
    unreviewedFailedAttempts: Array<{
      id: string;
      testRunId: string;
      runName: string;
      result: "FAILED" | "BLOCKED";
      executedAt: Date;
      testCaseTitle: string;
    }>;
  };
};

function client(dependencies?: ProjectQualityDependencies) {
  return dependencies?.prisma ?? getPrismaClient();
}

function newestDate(dates: Array<Date | null | undefined>): Date | null {
  const timestamps = dates
    .filter((value): value is Date => value instanceof Date)
    .map((value) => value.getTime());
  return timestamps.length ? new Date(Math.max(...timestamps)) : null;
}

export function freshnessFor(lastEvidenceAt: Date | null, now: Date) {
  if (!lastEvidenceAt) {
    return { freshness: "MISSING" as const, ageDays: null };
  }
  const ageDays = Math.max(
    0,
    Math.floor((now.getTime() - lastEvidenceAt.getTime()) / 86_400_000),
  );
  if (ageDays <= 7) return { freshness: "FRESH" as const, ageDays };
  if (ageDays <= 30) return { freshness: "AGING" as const, ageDays };
  return { freshness: "STALE" as const, ageDays };
}

export async function getProjectQualityIntelligence(
  input: { projectId: string; orgSlug?: string; now?: Date },
  dependencies?: ProjectQualityDependencies,
): Promise<ProjectQualityIntelligence> {
  const projectId = uuidSchema.parse(input.projectId);
  const now = input.now ?? new Date();
  const context = await requireWorkspaceContext(
    {
      orgSlug: input.orgSlug,
      projectId,
      permission: "project:read",
    },
    dependencies,
  );
  const organizationId = context.organization.id;
  const prisma = client(dependencies);
  const recentFailureCutoff = new Date(
    now.getTime() - RECENT_FAILURE_DAYS * 86_400_000,
  );

  const [project, requirements, testCases, recentFailedAttempts, recentAttemptEvidence, openFailureFindings] =
    await Promise.all([
      prisma.project.findUniqueOrThrow({
        where: { organizationId_id: { organizationId, id: projectId } },
        select: { id: true, name: true, slug: true },
      }),
      prisma.requirement.findMany({
        where: { organizationId, projectId, status: "APPROVED" },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          title: true,
          approvedAt: true,
          updatedAt: true,
          testCaseLinks: {
            select: {
              testCase: { select: { id: true, status: true } },
            },
          },
        },
      }),
      prisma.testCase.findMany({
        where: { organizationId, projectId, status: "APPROVED" },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        select: {
          id: true,
          title: true,
          currentVersionNumber: true,
          approvedAt: true,
          updatedAt: true,
          automationArtifacts: {
            where: { status: "APPROVED" },
            select: {
              id: true,
              name: true,
              engine: true,
              approvedAt: true,
              updatedAt: true,
              testCaseVersion: { select: { versionNumber: true } },
            },
          },
        },
      }),
      prisma.testRunAttempt.findMany({
        where: {
          organizationId,
          projectId,
          result: { in: ["FAILED", "BLOCKED"] },
          executedAt: { gte: recentFailureCutoff },
        },
        orderBy: [{ executedAt: "desc" }, { id: "asc" }],
        take: 25,
        select: {
          id: true,
          testRunId: true,
          result: true,
          executedAt: true,
          testRun: {
            select: {
              name: true,
              testCase: { select: { title: true } },
            },
          },
          failureAnalyses: {
            where: { status: "SUCCEEDED" },
            select: {
              findings: { select: { status: true } },
            },
          },
        },
      }),
      prisma.testRunAttempt.aggregate({
        where: {
          organizationId,
          projectId,
          executedAt: { gte: recentFailureCutoff },
        },
        _count: { id: true },
        _max: { executedAt: true },
      }),
      prisma.failureFinding.count({
        where: { organizationId, projectId, status: "OPEN" },
      }),
    ]);

  const requirementsWithoutApprovedTests = requirements
    .filter(
      (requirement) =>
        !requirement.testCaseLinks.some(
          (link) => link.testCase.status === "APPROVED",
        ),
    )
    .map((requirement) => ({
      id: requirement.id,
      title: requirement.title,
      updatedAt: requirement.updatedAt,
      linkedTestCaseCount: requirement.testCaseLinks.length,
    }));

  const testCasesWithoutCurrentAutomation = testCases
    .filter(
      (testCase) =>
        !testCase.automationArtifacts.some(
          (artifact) =>
            artifact.testCaseVersion.versionNumber ===
            testCase.currentVersionNumber,
        ),
    )
    .map((testCase) => ({
      id: testCase.id,
      title: testCase.title,
      currentVersionNumber: testCase.currentVersionNumber,
      updatedAt: testCase.updatedAt,
    }));

  const staleAutomation = testCases.flatMap((testCase) =>
    testCase.automationArtifacts
      .filter(
        (artifact) =>
          artifact.testCaseVersion.versionNumber < testCase.currentVersionNumber,
      )
      .map((artifact) => ({
        id: artifact.id,
        name: artifact.name,
        engine: artifact.engine,
        testCaseId: testCase.id,
        testCaseTitle: testCase.title,
        automatedVersionNumber: artifact.testCaseVersion.versionNumber,
        currentVersionNumber: testCase.currentVersionNumber,
        updatedAt: artifact.updatedAt,
      })),
  );

  const unreviewedFailedAttempts = recentFailedAttempts
    .filter(
      (attempt) =>
        (attempt.result === "FAILED" || attempt.result === "BLOCKED") &&
        !attempt.failureAnalyses.some(
          (analysis) =>
            analysis.findings.length > 0 &&
            analysis.findings.every((finding) => finding.status !== "OPEN"),
        ),
    )
    .map((attempt) => ({
      id: attempt.id,
      testRunId: attempt.testRunId,
      runName: attempt.testRun.name,
      result: attempt.result === "BLOCKED" ? ("BLOCKED" as const) : ("FAILED" as const),
      executedAt: attempt.executedAt,
      testCaseTitle: attempt.testRun.testCase.title,
    }));

  const lastEvidenceAt = newestDate([
    ...requirements.flatMap((requirement) => [
      requirement.approvedAt,
      requirement.updatedAt,
    ]),
    ...testCases.flatMap((testCase) => [
      testCase.approvedAt,
      testCase.updatedAt,
      ...testCase.automationArtifacts.flatMap((artifact) => [
        artifact.approvedAt,
        artifact.updatedAt,
      ]),
    ]),
    ...recentFailedAttempts.map((attempt) => attempt.executedAt),
    recentAttemptEvidence._max.executedAt,
  ]);
  const freshness = freshnessFor(lastEvidenceAt, now);
  const missing = [
    ...(requirements.length === 0 ? ["No approved Requirements"] : []),
    ...(testCases.length === 0 ? ["No approved Test Cases"] : []),
    ...(testCases.every((testCase) => testCase.automationArtifacts.length === 0)
      ? ["No approved automation"]
      : []),
    ...(recentAttemptEvidence._count.id === 0
      ? ["No execution attempts in the last 30 days"]
      : []),
  ];

  return {
    project,
    measuredAt: now,
    counts: {
      approvedRequirements: requirements.length,
      requirementsWithApprovedTests:
        requirements.length - requirementsWithoutApprovedTests.length,
      approvedTestCases: testCases.length,
      testCasesWithCurrentAutomation:
        testCases.length - testCasesWithoutCurrentAutomation.length,
      recentAttempts: recentAttemptEvidence._count.id,
      recentFailedAttempts: recentFailedAttempts.length,
      openFailureFindings,
    },
    evidence: {
      freshness: freshness.freshness,
      lastEvidenceAt,
      ageDays: freshness.ageDays,
      missing,
    },
    gaps: {
      requirementsWithoutApprovedTests,
      testCasesWithoutCurrentAutomation,
      staleAutomation,
      unreviewedFailedAttempts,
    },
  };
}
