import { describe, expect, it, vi } from "vitest";

import { workspaceYouCanOpen } from "@/lib/auth/other-workspace";

/**
 * Whether the address names a workspace this person may open.
 *
 * A workspace page resolves from the session's **active organization**, not
 * from the slug in the address, so anybody in two workspaces who follows a
 * link into the other one was told "That page is not here" about a project
 * they own. A teammate sharing a link is the ordinary way that happens.
 *
 * Found on 2026-11-22 when the owner could not open his own demo workspace
 * after it was repaired: his session was still in the other one, and the
 * switcher that fixes it sits on a page he could not reach.
 *
 * The other half matters as much. For somebody who is not a member the
 * answer must stay "not found": whether a workspace exists is not something
 * an address should be able to probe.
 */
const workspace = {
  name: "PlaywrightGen Demo",
  slug: "playwrightgen-demo",
  clerkOrganizationId: "org_demo",
  status: "ACTIVE" as const,
};

const prismaWith = (options: {
  organization?: typeof workspace | null;
  user?: { id: string } | null;
  membership?: { id: string } | null;
}) =>
  ({
    organization: { findFirst: vi.fn().mockResolvedValue(options.organization ?? workspace) },
    user: { findUnique: vi.fn().mockResolvedValue(options.user ?? null) },
    membership: { findFirst: vi.fn().mockResolvedValue(options.membership ?? null) },
  }) as never;

describe("the workspace in the address", () => {
  it("is offered when the person is a member and is somewhere else", async () => {
    const found = await workspaceYouCanOpen("playwrightgen-demo", {
      authenticate: async () => ({ userId: "user_1", orgId: "org_other" }),
      prisma: prismaWith({ user: { id: "u1" }, membership: { id: "m1" } }),
    });

    expect(found).toEqual({
      name: "PlaywrightGen Demo",
      slug: "playwrightgen-demo",
      clerkOrganizationId: "org_demo",
    });
  });

  it("stays silent for somebody who is not a member", async () => {
    // Not "you may not see this", which would confirm it exists.
    const found = await workspaceYouCanOpen("playwrightgen-demo", {
      authenticate: async () => ({ userId: "user_2", orgId: "org_other" }),
      prisma: prismaWith({ user: { id: "u2" }, membership: null }),
      clerkMemberships: async () => ["org_somewhere_else"],
    });

    expect(found).toBeNull();
  });

  it("asks the identity provider when the database has no row yet", async () => {
    /*
     * The state right after a workspace is repaired or an invitation is
     * accepted: Clerk knows, the mirror does not. Switching is what makes the
     * catch-up happen, because the next load resolves this organization as
     * the active one and writes the row.
     */
    const found = await workspaceYouCanOpen("playwrightgen-demo", {
      authenticate: async () => ({ userId: "user_3", orgId: "org_other" }),
      prisma: prismaWith({ user: null, membership: null }),
      clerkMemberships: async () => ["org_demo"],
    });

    expect(found?.clerkOrganizationId).toBe("org_demo");
  });

  it("says nothing when this workspace is already the active one", async () => {
    // Then the address failed for some other reason, and offering to switch
    // to where they already are would be a lie about the cause.
    const found = await workspaceYouCanOpen("playwrightgen-demo", {
      authenticate: async () => ({ userId: "user_1", orgId: "org_demo" }),
      prisma: prismaWith({ user: { id: "u1" }, membership: { id: "m1" } }),
    });

    expect(found).toBeNull();
  });

  it("says nothing to a signed-out visitor", async () => {
    const found = await workspaceYouCanOpen("playwrightgen-demo", {
      authenticate: async () => ({ userId: null, orgId: null }),
      prisma: prismaWith({}),
    });

    expect(found).toBeNull();
  });

  it("says nothing about a workspace that does not exist", async () => {
    const found = await workspaceYouCanOpen("never-existed", {
      authenticate: async () => ({ userId: "user_1", orgId: "org_other" }),
      prisma: prismaWith({ organization: null }),
    });

    expect(found).toBeNull();
  });

  it("does not offer an archived workspace", async () => {
    const found = await workspaceYouCanOpen("playwrightgen-demo", {
      authenticate: async () => ({ userId: "user_1", orgId: "org_other" }),
      prisma: prismaWith({ organization: { ...workspace, status: "ARCHIVED" as never } }),
    });

    expect(found).toBeNull();
  });

  it("stays silent when the identity provider cannot be reached", async () => {
    // An outage must not turn into an invitation.
    const found = await workspaceYouCanOpen("playwrightgen-demo", {
      authenticate: async () => ({ userId: "user_4", orgId: "org_other" }),
      prisma: prismaWith({ user: null, membership: null }),
      clerkMemberships: async () => {
        throw new Error("clerk is down");
      },
    });

    expect(found).toBeNull();
  });
});
