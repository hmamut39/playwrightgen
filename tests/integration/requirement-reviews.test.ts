import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient, ProjectMembershipRole } from "@/generated/prisma/client";
import { createRequirement } from "@/lib/services/requirements";
import {
  listRequirementReviews,
  resolveAiSuggestion,
  runRequirementReview,
} from "@/lib/services/requirement-reviews";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;

describe("advisory AI Requirement Review", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await connectTestDatabase(prisma);
  });
  beforeEach(async () => cleanPhase1ATables(prisma));
  afterAll(async () => {
    await cleanPhase1ATables(prisma);
    await disconnectTestDatabase(prisma);
  });

  async function workspace() {
    const owner = await prisma.user.create({
      data: { clerkUserId: unique("owner"), displayName: "Owner" },
    });
    const organization = await prisma.organization.create({
      data: {
        clerkOrganizationId: unique("org"),
        name: "AI review workspace",
        slug: unique("ai-review"),
      },
    });
    await prisma.membership.create({
      data: { organizationId: organization.id, userId: owner.id, role: "OWNER" },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: organization.id,
        name: "Reviewed project",
        slug: unique("project"),
        createdByUserId: owner.id,
      },
    });
    const state = { owner, organization, project };
    const requirement = await createRequirement(
      {
        projectId: project.id,
        title: "Users can recover access",
        description: "A user can request an account recovery link.",
        acceptanceCriteria: "A valid account receives a single-use link.",
      },
      dependencies(state),
    );
    return { ...state, requirement };
  }

  function dependencies(
    state: Awaited<ReturnType<typeof workspace>> | Omit<Awaited<ReturnType<typeof workspace>>, "requirement">,
    actor = state.owner,
    reviewer = validReviewer,
  ) {
    return {
      authenticate: async () => ({
        userId: actor.clerkUserId,
        orgId: state.organization.clerkOrganizationId,
      }),
      prisma,
      reviewer,
    };
  }

  async function member(
    state: Awaited<ReturnType<typeof workspace>>,
    role: ProjectMembershipRole,
  ) {
    const user = await prisma.user.create({ data: { clerkUserId: unique("member") } });
    await prisma.membership.create({
      data: { organizationId: state.organization.id, userId: user.id, role: "MEMBER" },
    });
    await prisma.projectMembership.create({
      data: {
        organizationId: state.organization.id,
        projectId: state.project.id,
        userId: user.id,
        role,
      },
    });
    return user;
  }

  async function validReviewer() {
    return {
      model: "test-model",
      summary: "The requirement is understandable but one edge case needs clarification.",
      suggestions: [
        {
          category: "EDGE_CASE" as const,
          severity: "MEDIUM" as const,
          title: "Recovery link expiry is unspecified",
          observation: "The criterion states the link is single-use but not how long it remains valid.",
          evidenceField: "ACCEPTANCE_CRITERIA" as const,
          evidenceQuote: "single-use link",
          recommendation: "Define an expiry duration and observable expired-link behavior.",
        },
      ],
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    };
  }

  it("persists a version-bound run, suggestions, usage, and Activity", async () => {
    const state = await workspace();
    const run = await runRequirementReview(
      { projectId: state.project.id, requirementId: state.requirement.id },
      dependencies(state),
    );

    expect(run.status).toBe("SUCCEEDED");
    expect(run.model).toBe("test-model");
    expect(run.totalTokens).toBe(150);
    expect(run.suggestions).toHaveLength(1);
    expect(
      await prisma.activity.count({
        where: { targetId: run.id, action: "REQUIREMENT_REVIEW_COMPLETED" },
      }),
    ).toBe(1);
  });

  it("stores none of an invented quote, and still completes the review", async () => {
    /*
     * This asserted a 502 and a FAILED run until 2026-11-15.
     *
     * What must never happen is storing a suggestion that attributes words to
     * the customer they did not write, and that is asserted here twice: no
     * suggestion row at all, and the invented sentence present nowhere in the
     * run that was saved. Both hold.
     *
     * What changed is the rest of it. One invented quote used to fail the
     * whole run, and the reviewer met "the AI review did not finish" with no
     * reason in it. The eval found this as "reviewing a requirement does not
     * invent problems in a requirement that has none": a model pressed to
     * find fault in a clean requirement makes one up, so the ordinary case of
     * a well-written requirement was reaching people as an error.
     */
    const state = await workspace();
    const invalid = async () => ({
      ...(await validReviewer()),
      suggestions: [
        {
          ...(await validReviewer()).suggestions[0],
          evidenceQuote: "text that does not exist",
        },
      ],
    });

    const run = await runRequirementReview(
      { projectId: state.project.id, requirementId: state.requirement.id },
      dependencies(state, state.owner, invalid),
    );

    expect(run.status).toBe("SUCCEEDED");
    expect(run.suggestions).toHaveLength(0);
    expect(await prisma.aiSuggestion.count()).toBe(0);

    const saved = await prisma.aiRun.findFirst();
    expect(saved?.status).toBe("SUCCEEDED");
    // The words the model invented reached no column.
    expect(JSON.stringify(saved)).not.toContain("text that does not exist");
    // And the reviewer is told why there is nothing to look at.
    expect(saved?.summary).toContain("quoted words that are not in this requirement");
  });

  it("lets the people who write requirements review them, but not a viewer", async () => {
    // The review is an authoring aid: the member drafting a requirement is the
    // person who most needs to hear it is ambiguous.
    const state = await workspace();
    const ordinary = await member(state, "MEMBER");
    const viewer = await member(state, "VIEWER");

    await expect(
      runRequirementReview(
        { projectId: state.project.id, requirementId: state.requirement.id },
        dependencies(state, viewer),
      ),
    ).rejects.toMatchObject({ code: "permission_denied", status: 403 });
    expect(
      (await runRequirementReview(
        { projectId: state.project.id, requirementId: state.requirement.id },
        dependencies(state, ordinary),
      )).status,
    ).toBe("SUCCEEDED");
  });

  it("accepts a suggestion without mutating Requirement content", async () => {
    const state = await workspace();
    const original = await prisma.requirement.findUniqueOrThrow({
      where: { id: state.requirement.id },
    });
    const run = await runRequirementReview(
      { projectId: state.project.id, requirementId: state.requirement.id },
      dependencies(state),
    );
    const suggestion = await resolveAiSuggestion(
      {
        projectId: state.project.id,
        requirementId: state.requirement.id,
        suggestionId: run.suggestions[0].id,
        resolution: "ACCEPTED",
      },
      dependencies(state),
    );
    const after = await prisma.requirement.findUniqueOrThrow({
      where: { id: state.requirement.id },
    });

    expect(suggestion.status).toBe("ACCEPTED");
    expect(after.title).toBe(original.title);
    expect(after.currentVersionNumber).toBe(original.currentVersionNumber);
    await expect(
      resolveAiSuggestion(
        {
          projectId: state.project.id,
          requirementId: state.requirement.id,
          suggestionId: suggestion.id,
          resolution: "DISMISSED",
        },
        dependencies(state),
      ),
    ).rejects.toMatchObject({ code: "suggestion_not_open", status: 409 });
  });

  it("never lists a foreign tenant review", async () => {
    const first = await workspace();
    const second = await workspace();
    await runRequirementReview(
      { projectId: second.project.id, requirementId: second.requirement.id },
      dependencies(second),
    );
    expect(
      await listRequirementReviews(
        { projectId: first.project.id, requirementId: first.requirement.id },
        dependencies(first),
      ),
    ).toEqual([]);
  });
});
