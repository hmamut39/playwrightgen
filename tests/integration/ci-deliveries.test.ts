import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { buildTestCaseVersionMarker } from "@/lib/integrations/runner/ingest-token";
import { readLastCiDelivery, readLastCiRejection } from "@/lib/services/ci-deliveries";
import { recordCiRejection } from "@/lib/services/ci-rejections";
import {
  ingestPlaywrightResults,
  type IngestPayload,
} from "@/lib/services/test-run-ingest";
import {
  approveTestCase,
  createTestCase,
  submitTestCaseForReview,
} from "@/lib/services/test-cases";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;
const numericId = () => String(Math.floor(Math.random() * 1_000_000_000) + 1);

/**
 * "Did my pipeline reach you?"
 *
 * A team with an existing Playwright suite reports hundreds of results that
 * carry no marker, and none of them are recorded -- correctly. What was wrong
 * is that this left no trace anywhere, so a wrong token and a working pipeline
 * produced the same empty page. The delivery is now recorded whether or not it
 * recorded anything.
 */
describe("what a delivery from CI leaves behind", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await connectTestDatabase(prisma);
  });
  beforeEach(async () => cleanPhase1ATables(prisma));
  afterAll(async () => {
    if (prisma) {
      await cleanPhase1ATables(prisma);
      await disconnectTestDatabase(prisma);
    }
  });

  async function workspace() {
    const owner = await prisma.user.create({
      data: { clerkUserId: unique("owner"), displayName: "Owner" },
    });
    const organization = await prisma.organization.create({
      data: { clerkOrganizationId: unique("org"), name: "Shop", slug: unique("shop") },
    });
    await prisma.membership.create({
      data: { organizationId: organization.id, userId: owner.id, role: "OWNER" },
    });
    const project = await prisma.project.create({
      data: {
        organizationId: organization.id,
        name: "Checkout",
        slug: unique("checkout"),
        createdByUserId: owner.id,
      },
    });
    const installation = await prisma.gitHubInstallation.create({
      data: {
        organizationId: organization.id,
        externalInstallationId: numericId(),
        accountId: "1",
        accountLogin: "acme",
        accountType: "User",
        repositorySelection: "selected",
        connectedByUserId: owner.id,
      },
    });
    await prisma.repositoryConnection.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        githubInstallationId: installation.id,
        externalRepositoryId: numericId(),
        ownerLogin: "acme",
        name: "web",
        fullName: "acme/web",
        defaultBranch: "main",
        visibility: "PUBLIC",
        status: "ACTIVE",
        createdByUserId: owner.id,
      },
    });
    return { owner, organization, project };
  }

  const deps = (space: Awaited<ReturnType<typeof workspace>>) => ({
    authenticate: async () => ({
      userId: space.owner.clerkUserId,
      orgId: space.organization.clerkOrganizationId,
    }),
    prisma,
  });

  async function approvedVersionId(space: Awaited<ReturnType<typeof workspace>>) {
    const record = await createTestCase(
      {
        projectId: space.project.id,
        title: "Customer completes checkout",
        objective: "A signed-in customer can place an order.",
        preconditions: "A product is in stock.",
        steps: ["Open the cart", "Submit valid payment"],
        expectedResults: ["Order confirmation is displayed"],
        priority: "HIGH",
        type: "END_TO_END",
        tags: ["checkout"],
      },
      deps(space),
    );
    await submitTestCaseForReview(
      { projectId: space.project.id, testCaseId: record.id },
      deps(space),
    );
    await approveTestCase({ projectId: space.project.id, testCaseId: record.id }, deps(space));
    const version = await prisma.testCaseVersion.findFirstOrThrow({
      where: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        testCaseId: record.id,
      },
      orderBy: { versionNumber: "desc" },
      select: { id: true },
    });
    return version.id;
  }

  function payload(
    space: Awaited<ReturnType<typeof workspace>>,
    titles: string[],
    overrides: Partial<IngestPayload["run"]> = {},
  ): IngestPayload {
    return {
      organizationId: space.organization.id,
      projectId: space.project.id,
      run: {
        provider: "gitlab_ci",
        externalId: "4411-99",
        url: "https://gitlab.example.com/acme/web/-/jobs/99",
        commitSha: "b".repeat(40),
        ref: "main",
        ...overrides,
      },
      environment: "STAGING",
      browser: "CHROMIUM",
      baseUrl: null,
      results: titles.map((title) => ({ title, status: "passed" as const, durationMs: 100 })),
    };
  }

  it("records a delivery that recorded nothing, and says why", async () => {
    const space = await workspace();

    // A real existing suite: good tests, none of them written here.
    const summary = await ingestPlaywrightResults(
      payload(space, ["login works", "cart totals are right", "search returns results"]),
      { prisma },
    );
    expect(summary).toMatchObject({ recorded: 0, duplicates: 0, unmatched: 3 });

    const delivery = await readLastCiDelivery({ projectId: space.project.id }, deps(space));
    expect(delivery).not.toBeNull();
    expect(delivery).toMatchObject({
      provider: "gitlab_ci",
      ref: "main",
      recorded: 0,
      unmatched: 3,
      total: 3,
      runUrl: "https://gitlab.example.com/acme/web/-/jobs/99",
    });
    // The whole point: the page can now explain an empty Test Runs tab.
    expect(delivery?.note).toContain("None of the 3 results were recorded");
    expect(delivery?.note).toContain("marker");
  });

  it("records a delivery that did attach results", async () => {
    const space = await workspace();
    const versionId = await approvedVersionId(space);

    await ingestPlaywrightResults(
      payload(space, [
        `${buildTestCaseVersionMarker(versionId)} customer completes checkout`,
        "an unrelated test of theirs",
      ]),
      { prisma },
    );

    const delivery = await readLastCiDelivery({ projectId: space.project.id }, deps(space));
    expect(delivery).toMatchObject({ recorded: 1, unmatched: 1, total: 2 });
    expect(delivery?.note).toContain("Recorded 1 of 2 results.");
  });

  it("tells a marker for another project apart from no marker at all", async () => {
    const space = await workspace();
    // A real uuid that is not a version in this project: what a result looks
    // like when the tests belong to a different PlaywrightGen project, or the
    // version they were written against has been removed.
    const stranger = "11111111-1111-4111-8111-111111111111";

    const summary = await ingestPlaywrightResults(
      payload(space, [
        `[pwg:${stranger}] a test from somewhere else`,
        "a test with no marker at all",
      ]),
      { prisma },
    );

    expect(summary).toMatchObject({ recorded: 0, unmatched: 1, unknownVersion: 1 });

    const delivery = await readLastCiDelivery({ projectId: space.project.id }, deps(space));
    expect(delivery).toMatchObject({ unmatched: 1, unknownVersion: 1, total: 2 });
    // Both causes named, because a delivery can carry some of each and the
    // advice for them is opposite.
    expect(delivery?.note).toContain("Tests written elsewhere carry no marker");
    expect(delivery?.note).toContain("a test version this project does not have");
  });

  it("says nothing has arrived when nothing has", async () => {
    const space = await workspace();

    expect(await readLastCiDelivery({ projectId: space.project.id }, deps(space))).toBeNull();
  });

  it("shows the most recent delivery, not the first", async () => {
    const space = await workspace();

    await ingestPlaywrightResults(payload(space, ["one"], { externalId: "1" }), { prisma });
    await ingestPlaywrightResults(
      payload(space, ["one", "two"], { externalId: "2", ref: "release/2026-10" }),
      { prisma },
    );

    const delivery = await readLastCiDelivery({ projectId: space.project.id }, deps(space));
    expect(delivery).toMatchObject({ ref: "release/2026-10", total: 2 });
  });

  it("remembers a delivery it turned away, and what to do about it", async () => {
    const space = await workspace();
    await recordCiRejection(
      {
        organizationId: space.organization.id,
        projectId: space.project.id,
        reason: "stale_token",
        provider: "github_actions",
        externalId: "9001-1",
        url: "https://github.com/acme/web/actions/runs/9001",
        ref: "main",
        commitSha: "a".repeat(40),
        total: 4,
      },
      { prisma },
    );

    const rejection = await readLastCiRejection({ projectId: space.project.id }, deps(space));
    expect(rejection).toMatchObject({ reason: "stale_token", provider: "github_actions", ref: "main" });
    // The fix is named, not just the fault.
    expect(rejection?.note).toContain("PLAYWRIGHTGEN_TOKEN");

    // A refusal is not a delivery: it recorded nothing and must not appear
    // as though a pipeline had reported results.
    expect(await readLastCiDelivery({ projectId: space.project.id }, deps(space))).toBeNull();
  });

  it("stays quiet about a reason this version does not understand", async () => {
    const space = await workspace();
    await prisma.activity.create({
      data: {
        organizationId: space.organization.id,
        projectId: space.project.id,
        actorUserId: null,
        source: "SYSTEM",
        action: "CI_RESULTS_REJECTED",
        targetType: "PROJECT",
        targetId: space.project.id,
        metadata: { reason: "something_invented_later" },
      },
    });

    // These rows are permanent and outlive the code that wrote them. An
    // explanation nobody can act on is worse than none.
    expect(await readLastCiRejection({ projectId: space.project.id }, deps(space))).toBeNull();
  });

  it("keeps one workspace's deliveries out of another's", async () => {
    const theirs = await workspace();
    const ours = await workspace();
    await ingestPlaywrightResults(payload(theirs, ["their test"]), { prisma });

    // Our project saw no delivery, and reading theirs from here must not work.
    expect(await readLastCiDelivery({ projectId: ours.project.id }, deps(ours))).toBeNull();
    await expect(
      readLastCiDelivery({ projectId: theirs.project.id }, deps(ours)),
    ).rejects.toThrow();
  });
});
