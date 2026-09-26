import { describe, expect, it } from "vitest";

import { evidenceDocument, evidenceFileName } from "@/lib/services/evidence-document";
import type { ReleaseEvidenceReport } from "@/lib/services/release-evidence";

const report = (overrides: Partial<ReleaseEvidenceReport> = {}): ReleaseEvidenceReport => ({
  project: { id: "p1", name: "Shop", slug: "shop" },
  organization: { name: "Acme", slug: "acme" },
  generatedAt: new Date("2026-09-20T14:30:00.000Z"),
  totals: { verified: 2, failing: 1, unverified: 0, stale: 0 },
  truncated: false,
  requirements: [
    {
      id: "r1",
      title: "Customer can pay",
      status: "APPROVED",
      versionNumber: 3,
      externalReference: "JIRA-12",
      verdict: "VERIFIED",
      reason: "Two approved tests verify this, both passed.",
      lastVerifiedAt: new Date("2026-09-19T08:05:00.000Z"),
      ageDays: 1,
      freshness: "FRESH",
      approvedBy: "Priya Raman",
      approvedAt: new Date("2026-09-18T10:00:00.000Z"),
      testCases: [
        {
          id: "t1",
          title: "Pays with a saved card",
          status: "APPROVED",
          versionNumber: 4,
          latestResult: "PASSED",
          latestExecutedAt: new Date("2026-09-19T08:05:00.000Z"),
          latestCommitSha: "abcdef1234567890",
          approvedBy: "Priya Raman",
          approvedAt: new Date("2026-09-19T12:00:00.000Z"),
          authoredByAgent: "Claude Code 2.1.0",
          signal: null,
        },
      ],
    },
  ],
  ...overrides,
});

describe("the evidence as a file someone can keep", () => {
  it("holds what the shared page shows, and no test code", () => {
    const html = evidenceDocument(report());
    expect(html).toContain("Customer can pay");
    expect(html).toContain("Pays with a saved card");
    expect(html).toContain("JIRA-12");
    expect(html).toContain("Two approved tests verify this, both passed.");
    // The commit is named short, the way a person quotes one.
    expect(html).toContain("abcdef12");
    expect(html).not.toContain("abcdef1234567890");
    // Nothing to fetch and nothing to run: it has to open from a file system.
    expect(html).not.toMatch(/<script|<link |src=|await page\.|getByRole\(/);
  });

  it("dates in UTC, because it is read somewhere else later", () => {
    const html = evidenceDocument(report());
    expect(html).toContain("2026-09-20 14:30 UTC");
    expect(html).toContain("2026-09-19 08:05 UTC");
  });

  it("says whether the date is a snapshot or a reading", () => {
    expect(evidenceDocument(report(), { frozen: true })).toContain("Snapshot taken 2026-09-20 14:30 UTC");
    expect(evidenceDocument(report())).toContain("Read 2026-09-20 14:30 UTC");
  });

  it("says plainly when nothing verifies a requirement", () => {
    const html = evidenceDocument(
      report({
        requirements: [
          {
            id: "r2",
            title: "Refunds work",
            status: "APPROVED",
            versionNumber: 1,
            externalReference: null,
            verdict: "UNVERIFIED",
            reason: "No approved test covers this.",
            lastVerifiedAt: null,
            ageDays: null,
            freshness: "MISSING",
            approvedBy: null,
            approvedAt: null,
            testCases: [],
          },
        ],
        totals: { verified: 0, failing: 0, unverified: 1, stale: 0 },
      }),
    );
    expect(html).toContain("No approved test case verifies this requirement.");
    expect(html).toContain("Not verified");
  });

  it("reports a test that never ran rather than leaving it blank", () => {
    const base = report();
    const html = evidenceDocument(
      report({
        requirements: [
          {
            ...base.requirements[0],
            testCases: [{ ...base.requirements[0].testCases[0], latestResult: null, latestExecutedAt: null, latestCommitSha: null }],
          },
        ],
      }),
    );
    expect(html).toContain("never run");
  });

  it("a title with markup in it cannot write the document", () => {
    const html = evidenceDocument(
      report({
        requirements: [
          {
            ...report().requirements[0],
            title: '<img src=x onerror="alert(1)">',
            reason: "5 > 3 & \"quoted\"",
          },
        ],
      }),
    );
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("5 &gt; 3 &amp; &quot;quoted&quot;");
    expect(html).not.toContain("<img");
  });

  it("names the file so it is recognisable a year later", () => {
    expect(evidenceFileName(report())).toBe("shop-test-evidence-2026-09-20.html");
    expect(evidenceFileName(report({ project: { id: "p", name: "Shop", slug: "Big Shop!" } }))).toBe(
      "big-shop--test-evidence-2026-09-20.html",
    );
  });
});

describe("how old the evidence is", () => {
  it("says it in words a reader does not have to work out", () => {
    const base = report().requirements[0];
    const html = (ageDays: number | null) =>
      evidenceDocument(report({ requirements: [{ ...base, ageDays }] }));
    expect(html(0)).toContain("checked today");
    expect(html(1)).toContain("checked yesterday");
    expect(html(94)).toContain("checked 94 days ago");
    expect(html(null)).toContain("never run");
  });

  it("counts stale verified requirements instead of hiding them", () => {
    const html = evidenceDocument(report({ totals: { verified: 4, failing: 0, unverified: 0, stale: 3 } }));
    expect(html).toContain("3 of the verified requirements were last checked more than a month ago");
    expect(evidenceDocument(report())).not.toContain("more than a month ago");
  });

  it("uses the singular when only one is stale", () => {
    const html = evidenceDocument(report({ totals: { verified: 1, failing: 0, unverified: 0, stale: 1 } }));
    expect(html).toContain("1 of the verified requirement was last checked more than a month ago");
  });
});

describe("who proposed the test", () => {
  it("names the assistant in the kept file, because the chain has to say", () => {
    const html = evidenceDocument(report());
    expect(html).toContain("Proposed by");
    expect(html).toContain("Claude Code 2.1.0");
    expect(html).toContain("the assistant is named; a person approved every");
  });

  it("says a person wrote it when no assistant did", () => {
    const base = report();
    const html = evidenceDocument(
      report({
        requirements: [
          {
            ...base.requirements[0],
            testCases: [{ ...base.requirements[0].testCases[0], authoredByAgent: null }],
          },
        ],
      }),
    );
    expect(html).toContain("<td>a person</td>");
    expect(html).not.toContain("Claude Code");
  });

  it("cannot have a name write markup into the document", () => {
    const base = report();
    const html = evidenceDocument(
      report({
        requirements: [
          {
            ...base.requirements[0],
            testCases: [
              { ...base.requirements[0].testCases[0], authoredByAgent: '<script>alert(1)</script>' },
            ],
          },
        ],
      }),
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("the acceptance in the kept file", () => {
  const signature = {
    signedName: "Dana Okonkwo",
    signedRole: "Product owner",
    note: "Accepted for the September release.",
    signedAt: new Date("2026-09-21T09:15:00.000Z"),
    evidenceHash: "abc123def4567890abc123def4567890abc123def4567890abc123def4567890",
  };

  it("names who accepted it, when, and which evidence", () => {
    const html = evidenceDocument(report(), { signatures: [signature] });
    expect(html).toContain("Accepted by");
    expect(html).toContain("Dana Okonkwo");
    expect(html).toContain("Product owner");
    expect(html).toContain("2026-09-21 09:15 UTC");
    // A short reference to the exact evidence, so a later reader can check.
    expect(html).toContain("abc123def456");
    expect(html).toContain("Accepted for the September release.");
  });

  it("says plainly that the identity was not verified", () => {
    const html = evidenceDocument(report(), { signatures: [signature] });
    expect(html).toContain("did not\n  verify their identity");
  });

  it("says nothing at all when nobody has accepted it", () => {
    expect(evidenceDocument(report())).not.toContain("Accepted by");
  });

  it("cannot have a signer's name write markup into the document", () => {
    const html = evidenceDocument(report(), {
      signatures: [{ ...signature, signedName: '<img src=x onerror="alert(1)">', note: "5 > 3" }],
    });
    expect(html).toContain("&lt;img src=x");
    expect(html).not.toContain("<img");
    expect(html).toContain("5 &gt; 3");
  });
});

describe("who approved it", () => {
  it("names the approver and the date, which is the sign-off record", () => {
    const html = evidenceDocument(report());
    expect(html).toContain("approved by Priya Raman on 2026-09-18 10:00 UTC");
    // And per test case, since that is what is checked one by one.
    expect(html).toContain("approved by Priya Raman on 2026-09-19 12:00 UTC");
  });

  it("says nothing when no approval is recorded, rather than implying one", () => {
    const base = report();
    const html = evidenceDocument(
      report({
        requirements: [
          {
            ...base.requirements[0],
            approvedBy: null,
            approvedAt: null,
            testCases: [{ ...base.requirements[0].testCases[0], approvedBy: null, approvedAt: null }],
          },
        ],
      }),
    );
    expect(html).not.toContain("approved by");
  });

  it("cannot have an approver's name write markup into the document", () => {
    const base = report();
    const html = evidenceDocument(
      report({
        requirements: [{ ...base.requirements[0], approvedBy: '<img src=x onerror="alert(1)">' }],
      }),
    );
    expect(html).toContain("&lt;img src=x");
    expect(html).not.toContain("<img");
  });
});
