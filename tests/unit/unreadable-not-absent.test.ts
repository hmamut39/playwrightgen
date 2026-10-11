import { describe, expect, it } from "vitest";

import { evidenceDocument } from "@/lib/services/evidence-document";
import type { EvidenceRequirement, ReleaseEvidenceReport } from "@/lib/services/release-evidence";

/**
 * A read that failed is not a fact about the project.
 *
 * Every surface on the evidence path caught a failed read and carried on with
 * an empty list, which renders identically to a project nobody has accepted.
 * On a page that is fine for a moment; in the file somebody keeps as the
 * record of a release it is a claim, made by a database blip, that no sign-off
 * happened.
 *
 * So the absence of acceptances and the inability to read them are now
 * different values, and the document says which one it is holding.
 */

const requirement: EvidenceRequirement = {
  id: "r1",
  title: "A customer can pay",
  status: "APPROVED",
  versionNumber: 1,
  externalReference: null,
  verdict: "VERIFIED",
  reason: "1 approved test last ran and passed.",
  lastVerifiedAt: new Date("2026-10-10T00:00:00.000Z"),
  ageDays: 1,
  freshness: "FRESH",
  approvedBy: "Dana Scully",
  approvedAt: new Date("2026-09-01T00:00:00.000Z"),
  criteriaCount: 1,
  testCases: [],
};

const report: ReleaseEvidenceReport = {
  project: { id: "p1", name: "Shop", slug: "shop" },
  organization: { name: "Acme", slug: "acme" },
  generatedAt: new Date("2026-10-11T09:00:00.000Z"),
  requirements: [requirement],
  totals: { verified: 1, failing: 0, unverified: 0, stale: 0 },
  truncated: false,
  coverage: { shown: 1, total: 1 },
};

describe("a kept record and an unreadable one", () => {
  it("says the acceptances could not be read, rather than showing none", () => {
    const html = evidenceDocument(report, { signatures: null });

    expect(html).toContain("Accepted by");
    expect(html).toContain("could not be read");
    // The sentence a reader needs, because the section header alone would
    // still look like an empty answer.
    expect(html).toContain("not a statement that nobody has accepted it");
  });

  it("stays silent when there genuinely are none", () => {
    const html = evidenceDocument(report, { signatures: [] });

    expect(html).not.toContain("could not be read");
    expect(html).not.toContain("Accepted by");
  });

  it("lists them when there are some", () => {
    const html = evidenceDocument(report, {
      signatures: [
        {
          signedName: "Fox Mulder",
          signedRole: "Head of QA",
          signedAt: new Date("2026-10-10T12:00:00.000Z"),
          evidenceHash: "abcdef0123456789",
          note: null,
        },
      ],
    });

    expect(html).toContain("Accepted by");
    expect(html).toContain("Fox Mulder");
    expect(html).not.toContain("could not be read");
  });
});
