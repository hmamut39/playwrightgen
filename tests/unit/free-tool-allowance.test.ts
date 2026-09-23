import { describe, expect, it } from "vitest";

import { readFreeToolAllowance } from "@/lib/operations/free-tool-access";

const request = new Request("https://playwrightgen.com/generator");

describe("what a free tool has left today", () => {
  it("gives a Team workspace its own allowance", async () => {
    const allowance = await readFreeToolAllowance(
      { request, surface: "quick-generate" },
      {
        identify: async () => ({ userId: "user_1", orgId: "org_1" }),
        findTeamOrganization: async () => "11111111-1111-4111-8111-111111111111",
        readTeam: async () => ({ remaining: 41, limit: 60 }),
        readPublic: async () => {
          throw new Error("a Team workspace must not be counted as a visitor");
        },
      },
    );
    expect(allowance).toEqual({ plan: "TEAM", remaining: 41, limit: 60 });
  });

  it("counts anyone else as a visitor, including when the workspace lookup fails", async () => {
    const visitor = await readFreeToolAllowance(
      { request, surface: "coverage-review" },
      {
        identify: async () => ({ userId: null, orgId: null }),
        readPublic: async (_request, surface) => ({ remaining: surface === "coverage-review" ? 3 : 0, limit: 5 }),
      },
    );
    expect(visitor).toEqual({ plan: "PUBLIC", remaining: 3, limit: 5 });

    // A failed lookup must never hand out the paid allowance.
    const broken = await readFreeToolAllowance(
      { request, surface: "quick-generate" },
      {
        identify: async () => ({ userId: "user_1", orgId: "org_1" }),
        findTeamOrganization: async () => {
          throw new Error("database unavailable");
        },
        readPublic: async () => ({ remaining: 5, limit: 5 }),
      },
    );
    expect(broken).toEqual({ plan: "PUBLIC", remaining: 5, limit: 5 });
  });
});
