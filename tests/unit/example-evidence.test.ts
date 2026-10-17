import { describe, expect, it, vi } from "vitest";

import { EXAMPLE_PROOF_TOKEN, examplePublished, exampleProofClaim } from "@/lib/services/release-proof";

/**
 * A stranger had to create an account, make a project, prove tests and share
 * a link before they ever saw the thing this product is for: a page somebody
 * outside the team can read. One project's evidence can be published to close
 * that gap, and what is published has to be deliberate.
 *
 * Only the project id is asked for. The first version wanted the
 * organization's id too, which appears nowhere a person can see it -- an id
 * nobody can find is a setting nobody sets, and the database already knows
 * which workspace owns a project.
 */
const projectId = "71d32705-91b6-48bd-9612-4abf3cb61573";
const organizationId = "1d8b44c5-8caf-4f0e-823c-8e4c3e42a8d2";

const prismaWith = (project: { id: string; organizationId: string } | null) =>
  ({ project: { findFirst: vi.fn().mockResolvedValue(project) } }) as never;

describe("publishing one project's evidence as the example", () => {
  it("names the workspace from the project, so only the visible id is asked for", async () => {
    const prisma = prismaWith({ id: projectId, organizationId });

    await expect(
      exampleProofClaim({ source: { EXAMPLE_EVIDENCE_PROJECT_ID: projectId }, prisma }),
    ).resolves.toEqual({ organizationId, projectId });
  });

  it("publishes nothing by default", async () => {
    // No default and no guessing: a project becomes public because somebody
    // decided it should, never because a variable went missing.
    const prisma = prismaWith({ id: projectId, organizationId });

    await expect(exampleProofClaim({ source: {}, prisma })).resolves.toBeNull();
    await expect(
      exampleProofClaim({ source: { EXAMPLE_EVIDENCE_PROJECT_ID: "   " }, prisma }),
    ).resolves.toBeNull();
    expect(examplePublished({})).toBe(false);
    expect(examplePublished({ EXAMPLE_EVIDENCE_PROJECT_ID: projectId })).toBe(true);
  });

  it("refuses an id that is not one rather than reading something else", async () => {
    const prisma = prismaWith({ id: projectId, organizationId });

    await expect(
      exampleProofClaim({ source: { EXAMPLE_EVIDENCE_PROJECT_ID: "the-checkout-project" }, prisma }),
    ).resolves.toBeNull();
  });

  it("publishes nothing when the named project is gone or archived", async () => {
    // The page then says what it says to any link it cannot honour, rather
    // than showing an empty report as though that were the evidence.
    await expect(
      exampleProofClaim({ source: { EXAMPLE_EVIDENCE_PROJECT_ID: projectId }, prisma: prismaWith(null) }),
    ).resolves.toBeNull();
  });

  it("reserves a word no real token can be", () => {
    // Tokens are pwgp1.<payload>.<signature>, so the reserved path cannot
    // collide with a link somebody was sent.
    expect(EXAMPLE_PROOF_TOKEN).toBe("example");
    expect(EXAMPLE_PROOF_TOKEN).not.toMatch(/^pwgp\d+\./);
  });
});
