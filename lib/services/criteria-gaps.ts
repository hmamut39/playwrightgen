import "server-only";

import { z } from "zod";

import {
  readCriteriaCoverage,
  CriteriaCoverageError,
  type CriteriaCoverage,
} from "@/lib/ai/criteria-coverage";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import { reserveOrganizationAiRequest } from "@/lib/operations/organization-ai-guard";

/**
 * What a requirement still needs, read from the requirement and the tests
 * approved against it.
 *
 * Kept deliberately out of the evidence: the result is returned to the screen
 * and never stored, never counted, and never allowed near a verdict. A
 * mapping nobody has verified is a useful prompt for a person and a bad thing
 * to show an auditor, and the difference between those two is whether it is
 * written down as fact.
 */

export class CriteriaGapsError extends Error {
  constructor(readonly code: "no_criteria" | "no_tests" | "unavailable") {
    super(code);
    this.name = "CriteriaGapsError";
  }
}

export type CriteriaGaps = CriteriaCoverage & {
  /** Criteria nothing appears to check, in the requirement's own words. */
  uncovered: string[];
};

export async function readRequirementGaps(
  input: { orgSlug?: string; projectId: string; requirementId: string },
  dependencies?: WorkspaceContextDependencies & {
    read?: (value: Parameters<typeof readCriteriaCoverage>[0]) => Promise<CriteriaCoverage>;
  },
): Promise<CriteriaGaps> {
  const projectId = z.string().uuid().parse(input.projectId);
  const requirementId = z.string().uuid().parse(input.requirementId);
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "testcase:create" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();

  const requirement = await prisma.requirement.findFirst({
    where: { organizationId: workspace.organization.id, projectId, id: requirementId },
    select: {
      title: true,
      acceptanceCriteria: true,
      testCaseLinks: {
        select: {
          testCase: {
            select: { status: true, title: true, objective: true, steps: true, expectedResults: true },
          },
        },
      },
    },
  });
  if (!requirement) throw new CriteriaGapsError("no_criteria");

  const acceptanceCriteria = requirement.acceptanceCriteria
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (acceptanceCriteria.length === 0) throw new CriteriaGapsError("no_criteria");

  // Only approved tests: a draft proves nothing, so counting it here would
  // tell somebody a criterion is covered when nothing has agreed to cover it.
  const asText = (value: unknown) =>
    Array.isArray(value) ? value.filter((line): line is string => typeof line === "string") : [];
  const tests = requirement.testCaseLinks
    .map((link) => link.testCase)
    .filter((testCase) => testCase.status === "APPROVED")
    .map((testCase) => ({
      title: testCase.title,
      objective: testCase.objective,
      steps: asText(testCase.steps),
      expectedResults: asText(testCase.expectedResults),
    }));
  if (tests.length === 0) throw new CriteriaGapsError("no_tests");

  await reserveOrganizationAiRequest({
    organizationId: workspace.organization.id,
    surface: "criteria-coverage",
  });

  let coverage: CriteriaCoverage;
  try {
    coverage = await (dependencies?.read ?? readCriteriaCoverage)({
      requirementTitle: requirement.title,
      acceptanceCriteria,
      tests,
    });
  } catch (error) {
    if (error instanceof CriteriaCoverageError) throw new CriteriaGapsError("unavailable");
    throw error;
  }

  return {
    ...coverage,
    uncovered: coverage.criteria.filter((entry) => !entry.covered).map((entry) => entry.criterion),
  };
}
