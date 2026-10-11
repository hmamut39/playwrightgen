import { describe, expect, it } from "vitest";

import { badgeMessage } from "@/lib/services/evidence-badge";
import { evidenceDocument } from "@/lib/services/evidence-document";
import type { EvidenceRequirement, ReleaseEvidenceReport } from "@/lib/services/release-evidence";
import { coverageText } from "@/lib/services/weekly-digest";

/**
 * A report that covers part of a project must say so wherever it is read.
 *
 * The report is bounded at five hundred requirements so a large project
 * produces a report rather than a timeout, and it already carried `truncated`.
 * Only two of its six readers looked: the badge in somebody's README said
 * "480 of 500 verified" for a project with nine hundred requirements, the
 * shared proof link showed the same counts as a project total, the weekly
 * email kept the totals and dropped the caveat with the rest of the report,
 * and the agent tool repeated them to whoever asked.
 *
 * Careful wording on one page does not travel. These tests hold each exit to
 * it separately, because that is the only way it stays true.
 */

const requirement = (title: string): EvidenceRequirement => ({
  id: `r-${title}`,
  title,
  status: "APPROVED",
  versionNumber: 1,
  externalReference: null,
  verdict: "VERIFIED",
  reason: "1 approved test last ran and passed.",
  lastVerifiedAt: new Date("2026-10-01T00:00:00.000Z"),
  ageDays: 3,
  freshness: "FRESH",
  approvedBy: "Dana Scully",
  approvedAt: new Date("2026-09-01T00:00:00.000Z"),
  criteriaCount: 1,
  testCases: [],
});

const report = (overrides: Partial<ReleaseEvidenceReport> = {}): ReleaseEvidenceReport => ({
  project: { id: "p1", name: "Shop", slug: "shop" },
  organization: { name: "Acme", slug: "acme" },
  generatedAt: new Date("2026-10-11T09:00:00.000Z"),
  requirements: [requirement("A customer can pay")],
  totals: { verified: 480, failing: 0, unverified: 20, stale: 0 },
  truncated: true,
  coverage: { shown: 500, total: 912 },
  ...overrides,
});

const acceptance = (name: string) => ({
  signedName: name,
  signedRole: null,
  note: null,
  signedAt: new Date("2026-10-10T12:00:00.000Z"),
  evidenceHash: "abcdef0123456789",
});
describe("a report that covers part of a project", () => {
  it("says so in the file somebody keeps", () => {
    const html = evidenceDocument(report());

    expect(html).toContain("500");
    expect(html).toContain("912");
    // Not "the project has more", which leaves a reader to wonder how much.
    expect(html).toContain("not the whole project");
  });

  it("says nothing of the kind when it covers everything", () => {
    const html = evidenceDocument(
      report({ truncated: false, coverage: { shown: 912, total: 912 } }),
    );

    expect(html).not.toContain("not the whole project");
  });

  it("says when the acceptances listed are not all of them", () => {
    // The same defect the requirement count had, in the same file somebody
    // keeps: a listing bounded at fifty showed fifty and implied they were
    // all of them. A compliance pack that under-reports who signed off is
    // worse than one that lists none, because it looks complete.
    const html = evidenceDocument(report({ truncated: false, coverage: { shown: 1, total: 1 } }), {
      signatures: { items: [acceptance("Dana Scully")], total: 64 },
    });

    expect(html).toContain("64");
    expect(html).toContain("not all of them");
  });

  it("stays quiet when every acceptance is listed", () => {
    const html = evidenceDocument(report({ truncated: false, coverage: { shown: 1, total: 1 } }), {
      signatures: { items: [acceptance("Dana Scully")], total: 1 },
    });

    expect(html).toContain("Dana Scully");
    expect(html).not.toContain("not all of them");
  });

  it("says so in a badge, where the denominator is the claim", () => {
    expect(
      badgeMessage({ kind: "verified", verified: 480, total: 500, partial: true }),
    ).toContain("of first 500");
    // A failure count from part of a project is a floor, not a total.
    expect(badgeMessage({ kind: "failing", failing: 2, partial: true })).toBe("2+ failing");
  });

  it("says so in the weekly email, which is read away from any page", () => {
    const line = coverageText({
      verified: 480,
      failing: 0,
      unverified: 20,
      stale: 0,
      partial: true,
      coverage: { shown: 500, total: 912 },
    });

    expect(line).toContain("500");
    expect(line).toContain("912");
  });

  it("leaves a complete week's email unqualified", () => {
    const line = coverageText({
      verified: 12,
      failing: 0,
      unverified: 0,
      stale: 0,
      partial: false,
      coverage: { shown: 12, total: 12 },
    });

    expect(line).toBe("12 requirements: 12 verified.");
  });
});
