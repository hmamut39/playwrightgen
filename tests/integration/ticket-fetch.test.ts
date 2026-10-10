import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { GitHubIssueError } from "@/lib/integrations/github/issue";
import { fetchTicketFromGitHub } from "@/lib/services/ticket-fetch";
import {
  cleanPhase1ATables,
  connectTestDatabase,
  createTestPrismaClient,
  disconnectTestDatabase,
} from "@/tests/helpers/database";

const unique = (prefix: string) => `${prefix}-${randomUUID()}`;
const numericId = () => String(Math.floor(Math.random() * 1_000_000_000) + 1);

/**
 * Which issues a project may read.
 *
 * The App can be installed on an account's other repositories, so the question
 * is not "can we reach this issue" but "did this project connect this
 * repository". The connection is the permission, and these tests hold that
 * line: everything else about the fetch is convenience.
 */
describe("fetching a ticket from GitHub", () => {
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

  async function workspace(options: { connect?: { owner: string; name: string } } = {}) {
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
    if (options.connect) {
      await prisma.repositoryConnection.create({
        data: {
          organizationId: organization.id,
          projectId: project.id,
          githubInstallationId: installation.id,
          externalRepositoryId: numericId(),
          ownerLogin: options.connect.owner,
          name: options.connect.name,
          fullName: `${options.connect.owner}/${options.connect.name}`,
          defaultBranch: "main",
          visibility: "PRIVATE",
          status: "ACTIVE",
          createdByUserId: owner.id,
        },
      });
    }
    return { owner, organization, project, installation };
  }

  const deps = (
    space: Awaited<ReturnType<typeof workspace>>,
    fetchIssue = vi.fn().mockResolvedValue({
      number: 123,
      title: "A customer can pay with a saved card",
      body: "A returning customer pays with a card they saved earlier.",
      state: "open",
      url: "https://github.com/acme/web/issues/123",
      labels: ["checkout", "payments"],
    }),
  ) => ({
    authenticate: async () => ({
      userId: space.owner.clerkUserId,
      orgId: space.organization.clerkOrganizationId,
    }),
    prisma,
    fetchIssue,
  });

  it("reads an issue from a repository this project connected", async () => {
    const space = await workspace({ connect: { owner: "acme", name: "web" } });
    const dependencies = deps(space);

    const ticket = await fetchTicketFromGitHub(
      { projectId: space.project.id, url: "https://github.com/acme/web/issues/123" },
      dependencies,
    );

    expect(ticket.reference).toBe("acme/web#123");
    expect(ticket.ticket).toContain("A customer can pay with a saved card");
    // Labels are often the only statement of scope a ticket has.
    expect(ticket.ticket).toContain("Labels: checkout, payments");
    expect(ticket.ticket).toContain("card they saved earlier");

    // The token is minted for the connected repository, not for whatever the
    // address claimed.
    expect(dependencies.fetchIssue.mock.calls[0][0]).toMatchObject({
      ownerLogin: "acme",
      repositoryName: "web",
      issueNumber: 123,
      installationId: space.installation.externalInstallationId,
    });
  });

  it("refuses a repository this project has not connected", async () => {
    const space = await workspace({ connect: { owner: "acme", name: "web" } });
    const dependencies = deps(space);

    // The App may well be installed on acme/secrets. That is not this
    // project's business, and no request is made at all.
    await expect(
      fetchTicketFromGitHub(
        { projectId: space.project.id, url: "https://github.com/acme/secrets/issues/1" },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "repository_not_connected" });
    expect(dependencies.fetchIssue).not.toHaveBeenCalled();
  });

  it("refuses when the connection is no longer active", async () => {
    const space = await workspace({ connect: { owner: "acme", name: "web" } });
    await prisma.repositoryConnection.updateMany({
      where: { projectId: space.project.id },
      data: { status: "ACCESS_REMOVED" },
    });
    const dependencies = deps(space);

    await expect(
      fetchTicketFromGitHub(
        { projectId: space.project.id, url: "https://github.com/acme/web/issues/123" },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "repository_not_connected" });
    expect(dependencies.fetchIssue).not.toHaveBeenCalled();
  });

  it("keeps one project's connection from serving another", async () => {
    const theirs = await workspace({ connect: { owner: "acme", name: "web" } });
    const ours = await workspace();
    const dependencies = deps(ours);

    // Same organization, different project: the connection belongs to theirs.
    await expect(
      fetchTicketFromGitHub(
        { projectId: ours.project.id, url: "https://github.com/acme/web/issues/123" },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "repository_not_connected" });
    expect(theirs.project.id).not.toBe(ours.project.id);
    expect(dependencies.fetchIssue).not.toHaveBeenCalled();
  });

  it("matches the repository however the address was capitalised", async () => {
    const space = await workspace({ connect: { owner: "Acme", name: "Web" } });

    const ticket = await fetchTicketFromGitHub(
      { projectId: space.project.id, url: "https://github.com/acme/web/issues/123" },
      deps(space),
    );

    // GitHub treats these as the same repository, and a person pasting an
    // address should not have to care.
    expect(ticket.reference).toBe("Acme/Web#123");
  });

  it("reports a pull request as what it is", async () => {
    const space = await workspace({ connect: { owner: "acme", name: "web" } });
    const fetchIssue = vi.fn().mockRejectedValue(new GitHubIssueError("issue_is_a_pull_request"));

    await expect(
      fetchTicketFromGitHub(
        { projectId: space.project.id, url: "https://github.com/acme/web/issues/9" },
        deps(space, fetchIssue),
      ),
    ).rejects.toMatchObject({ code: "issue_is_a_pull_request" });
  });

  it("refuses an address that is not a GitHub issue before anything else", async () => {
    const space = await workspace({ connect: { owner: "acme", name: "web" } });
    const dependencies = deps(space);

    await expect(
      fetchTicketFromGitHub(
        { projectId: space.project.id, url: "https://evil.example.com/acme/web/issues/1" },
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "not_a_github_issue" });
    expect(dependencies.fetchIssue).not.toHaveBeenCalled();
  });
});
