import { describe, expect, it } from "vitest";

import { EXAMPLE_PROOF_TOKEN, exampleProofClaim } from "@/lib/services/release-proof";

/**
 * A stranger has to create an account, make a project, prove tests and share
 * a link before they ever see the thing this product is for: a page somebody
 * outside the team can read. One project's evidence can be published to close
 * that gap, and what is published has to be deliberate.
 */
const uuid = "71d32705-91b6-48bd-9612-4abf3cb61573";
const other = "1d8b44c5-8caf-4f0e-823c-8e4c3e42a8d2";

describe("publishing one project's evidence as the example", () => {
  it("publishes only when both ids are given", () => {
    expect(
      exampleProofClaim({ EXAMPLE_EVIDENCE_ORG_ID: other, EXAMPLE_EVIDENCE_PROJECT_ID: uuid }),
    ).toEqual({ organizationId: other, projectId: uuid });
  });

  it("publishes nothing by default", () => {
    // No default and no guessing: a project becomes public because somebody
    // decided it should, never because a variable was missing.
    expect(exampleProofClaim({})).toBeNull();
    expect(exampleProofClaim({ EXAMPLE_EVIDENCE_ORG_ID: other })).toBeNull();
    expect(exampleProofClaim({ EXAMPLE_EVIDENCE_PROJECT_ID: uuid })).toBeNull();
    expect(exampleProofClaim({ EXAMPLE_EVIDENCE_ORG_ID: "  ", EXAMPLE_EVIDENCE_PROJECT_ID: uuid })).toBeNull();
  });

  it("refuses ids that are not ids rather than reading something else", () => {
    expect(
      exampleProofClaim({ EXAMPLE_EVIDENCE_ORG_ID: "acme", EXAMPLE_EVIDENCE_PROJECT_ID: uuid }),
    ).toBeNull();
  });

  it("reserves a word no real token can be", () => {
    // Tokens are pwgp1.<payload>.<signature>, so the reserved path cannot
    // collide with a link somebody was sent.
    expect(EXAMPLE_PROOF_TOKEN).toBe("example");
    expect(EXAMPLE_PROOF_TOKEN).not.toMatch(/^pwgp\d+\./);
  });
});
