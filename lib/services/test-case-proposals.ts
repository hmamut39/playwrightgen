import "server-only";

import { z } from "zod";

import {
  proposeTestCases,
  type TestCaseProposalInput,
  type TestCaseProposalResult,
} from "@/lib/ai/test-case-proposals";
import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import { getPrismaClient } from "@/lib/db/prisma";
import {
  OrganizationAiRateLimitError,
  reserveOrganizationAiRequest,
} from "@/lib/operations/organization-ai-guard";
import { createTestCase } from "@/lib/services/test-cases";

/**
 * Turns one approved Requirement into reviewable Test Case drafts.
 *
 * The chain used to ask a person to write test intent by hand before any of the
 * automated parts could help them, which is the slowest step and the one most
 * often skipped, leaving requirements approved and unverified.
 *
 * Three properties keep this from weakening the evidence model.
 *
 * Proposals are created as drafts through the ordinary creation path, so they
 * get the same immutable version 1, the same Activity record and the same
 * approval requirement as anything typed by hand. Nothing here can approve
 * itself.
 *
 * Each draft is linked to the Requirement it came from as it is created, so the
 * traceability that makes coverage mean anything exists from the first moment
 * rather than depending on someone remembering to add it.
 *
 * Only approved Requirements can be used. Proposing coverage for intent nobody
 * has agreed to would manufacture tests for a moving target, and the whole point
 * of approval is that it stops moving.
 */

const uuidSchema = z.string().uuid();
const guidanceSchema = z.string().trim().max(2_000);

export class TestCaseProposalDomainError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409 | 429 | 502 | 503;

  constructor(code: string, status: TestCaseProposalDomainError["status"]) {
    super(code);
    this.name = "TestCaseProposalDomainError";
    this.code = code;
    this.status = status;
  }
}

export type TestCaseProposalDependencies = WorkspaceContextDependencies & {
  propose?: (input: TestCaseProposalInput) => Promise<TestCaseProposalResult>;
};

export type ProposedTestCaseSummary = {
  id: string;
  title: string;
  coverage: string;
  rationale: string;
};

export type TestCaseProposalOutcome = {
  created: ProposedTestCaseSummary[];
  openQuestions: string[];
  model: string;
};

export async function proposeTestCasesForRequirement(
  input: {
    projectId: string;
    requirementId: string;
    orgSlug?: string;
    guidance?: string;
    requestId?: string;
  },
  dependencies?: TestCaseProposalDependencies,
): Promise<TestCaseProposalOutcome> {
  const projectId = parse(uuidSchema, input.projectId);
  const requirementId = parse(uuidSchema, input.requirementId);
  const guidance = parse(guidanceSchema, input.guidance ?? "");

  // Creating Test Cases is the effect, so it is the permission that gates this.
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId, permission: "testcase:create" },
    dependencies,
  );
  const prisma = dependencies?.prisma ?? getPrismaClient();
  const organizationId = workspace.organization.id;

  const requirement = await prisma.requirement.findUnique({
    where: { organizationId_projectId_id: { organizationId, projectId, id: requirementId } },
    select: {
      id: true,
      title: true,
      description: true,
      acceptanceCriteria: true,
      externalReference: true,
      status: true,
      testCaseLinks: {
        select: { testCase: { select: { title: true } } },
      },
    },
  });
  if (!requirement) {
    throw new TestCaseProposalDomainError("requirement_not_found", 404);
  }
  if (requirement.status !== "APPROVED") {
    throw new TestCaseProposalDomainError("requirement_not_approved", 409);
  }

  if (!dependencies?.propose) {
    try {
      await reserveOrganizationAiRequest({
        organizationId,
        surface: "test-case-proposals",
      });
    } catch (error) {
      if (error instanceof OrganizationAiRateLimitError) {
        throw new TestCaseProposalDomainError(error.code, 429);
      }
      throw new TestCaseProposalDomainError("ai_guard_unavailable", 503);
    }
  }

  let result: TestCaseProposalResult;
  try {
    result = await (dependencies?.propose ?? proposeTestCases)({
      title: requirement.title,
      description: requirement.description,
      acceptanceCriteria: requirement.acceptanceCriteria,
      externalReference: requirement.externalReference ?? "",
      // Supplied so the model does not re-propose coverage that already exists.
      existingTestCaseTitles: requirement.testCaseLinks.map((link) => link.testCase.title),
      guidance,
    });
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z_]+$/.test(error.message)
        ? error.message
        : "provider_failure";
    throw new TestCaseProposalDomainError(code, 502);
  }

  // Created one at a time through the ordinary path rather than in a single
  // transaction: each Test Case is independent evidence, and a proposal that
  // fails validation should not discard the ones that were sound.
  const created: ProposedTestCaseSummary[] = [];
  for (const proposal of result.proposals) {
    const testCase = await createTestCase(
      {
        projectId,
        orgSlug: input.orgSlug,
        title: proposal.title,
        objective: proposal.objective,
        preconditions: proposal.preconditions,
        steps: proposal.steps,
        expectedResults: proposal.expectedResults,
        priority: proposal.priority,
        type: proposal.type,
        source: "AI_SUGGESTED",
        requirementIds: [requirementId],
        requestId: input.requestId,
      },
      dependencies,
    );
    created.push({
      id: testCase.id,
      title: testCase.title,
      coverage: proposal.coverage,
      rationale: proposal.rationale,
    });
  }

  return { created, openQuestions: result.openQuestions, model: result.model };
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new TestCaseProposalDomainError("invalid_proposal_input", 400);
  }
  return parsed.data;
}
