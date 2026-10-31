import { describe, expect, it } from "vitest";

import { evidenceDocument, evidenceFileName } from "@/lib/services/evidence-document";
import type { ReleaseEvidenceReport } from "@/lib/services/release-evidence";

const report = (overrides: Partial<ReleaseEvidenceReport> = {}): ReleaseEvidenceReport => ({
  project: { id: "p1", name: "Shop", slug: "shop" },
  organization: { name: "Acme", slug: "acme" },
  generatedAt: new Date("2026-09-20T14:30:00.000Z"),
  unlinkedTests: [],
  totals: { verified: 2, failing: 1, unverified: 0, stale: 0 },
  truncated: false,
  coverage: { shown: 3, total: 3 },
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
      criteriaCount: 2,
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
            criteriaCount: 3,
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
    const html = evidenceDocument(report(), { signatures: { items: [signature], total: 1 } });
    expect(html).toContain("Accepted by");
    expect(html).toContain("Dana Okonkwo");
    expect(html).toContain("Product owner");
    expect(html).toContain("2026-09-21 09:15 UTC");
    // A short reference to the exact evidence, so a later reader can check.
    expect(html).toContain("abc123def456");
    expect(html).toContain("Accepted for the September release.");
  });

  it("says plainly that the identity was not verified", () => {
    const html = evidenceDocument(report(), { signatures: { items: [signature], total: 1 } });
    expect(html).toContain("did not\n  verify their identity");
  });

  it("says nothing at all when nobody asked about acceptances", () => {
    expect(evidenceDocument(report())).not.toContain("Accepted by");
  });

  it("does not let an empty section read as nobody having accepted", () => {
    // Found by downloading the file as the client: a file produced from a
    // shared link knows that link's acceptances and no others, and with none
    // of them it simply left the section out. A reader a year later takes
    // that silence for a project nobody ever signed off.
    const fromLink = evidenceDocument(report(), { signatures: { items: [], total: 0 }, signatureScope: "link" });
    expect(fromLink).toContain("Accepted by");
    expect(fromLink).toContain("link this file came from");
    expect(fromLink).toContain("can only speak for the one it was produced from");
  });

  it("stays silent when the file can see every acceptance and there are none", () => {
    // The team's own copy is read beside the project it came from, where
    // nothing is hidden, so an empty section would be noise rather than a
    // correction.
    const whole = evidenceDocument(report(), { signatures: { items: [], total: 0 } });
    expect(whole).not.toContain("Accepted by");
  });

  it("cannot have a signer's name write markup into the document", () => {
    const html = evidenceDocument(report(), {
      signatures: {
        items: [{ ...signature, signedName: '<img src=x onerror="alert(1)">', note: "5 > 3" }],
        total: 1,
      },
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

  it("still records the approval when the trail no longer names who made it", () => {
    // The approval and its time are on the artifact; the name is read back
    // from the activity trail, newest first, through a window. A project with
    // more approval events than that window holds loses the oldest names --
    // and the document used to decide on the name whether to mention the
    // approval at all, so an approved requirement exported as though nobody
    // had ever approved it. Weaker than a name, far better than silence.
    const base = report();
    const html = evidenceDocument(
      report({
        requirements: [
          {
            ...base.requirements[0],
            approvedBy: null,
            testCases: [{ ...base.requirements[0].testCases[0], approvedBy: null }],
          },
        ],
      }),
    );
    expect(html).toContain("approved on 2026-09-18");
    expect(html).toContain("approved on 2026-09-19");
    expect(html).toContain("the trail no longer names who");
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

describe("the pack an auditor is handed", () => {
  it("carries a reference that tells one set of evidence from another", () => {
    const html = evidenceDocument(report());
    const reference = /Document reference ([0-9a-f]{12})/.exec(html)?.[1];
    expect(reference).toBeDefined();
    // The same evidence read twice carries the same reference; different
    // evidence does not, or the reference would say nothing.
    expect(evidenceDocument(report())).toContain(`Document reference ${reference}`);
    const changed = report({ totals: { verified: 1, failing: 0, unverified: 0, stale: 0 } });
    expect(evidenceDocument(changed)).not.toContain(`Document reference ${reference}`);
  });

  it("says how the verdicts were reached, not only what they are", () => {
    const html = evidenceDocument(report());
    expect(html).toContain("How to read this");
    expect(html).toContain("assembled from stored records only");
    // It says which requirements it covers, and it is not only the approved ones.
    expect(html).toContain("approved ones");
    expect(html).toContain("drafts alike");
    expect(html).toContain("reported as not verified rather than assumed to be fine");
  });

  it("states its own limits, which is what makes it usable as evidence", () => {
    const html = evidenceDocument(report());
    // The three honest limits: identity, currency, completeness.
    expect(html).toContain("without verifying who they");
    expect(html).toContain("how long ago it was last checked");
    expect(html).toContain("only report requirements this project has recorded");
  });
});

describe("how much the requirement claims", () => {
  it("states the number of acceptance criteria next to the verdict", () => {
    const html = evidenceDocument(report());
    expect(html).toContain("2 acceptance criteria");
  });

  it("uses the singular for one, and says nothing when there are none", () => {
    const base = report().requirements[0];
    expect(evidenceDocument(report({ requirements: [{ ...base, criteriaCount: 1 }] }))).toContain(
      "1 acceptance criterion",
    );
    // None recorded: the requirement's own line says nothing rather than "0".
    const none = evidenceDocument(report({ requirements: [{ ...base, criteriaCount: 0 }] }));
    expect(none).not.toContain("0 acceptance criteri");
  });

  it("warns the reader that verified is not a claim about every criterion", () => {
    const html = evidenceDocument(report());
    expect(html).toContain("Verified is not a statement about every acceptance criterion");
  });
  /**
   * The downloadable file is the copy that outlives the link, so a test that
   * has nowhere to appear here has nowhere to appear at all once the link has
   * expired.
   */
  it("tabulates approved tests that verify no requirement, and says what they prove", () => {
    const html = evidenceDocument(
      report({
        requirements: [],
        unlinkedTests: [
          {
            id: "t9",
            title: "The checkout page loads",
            status: "APPROVED",
            versionNumber: 1,
            latestResult: "PASSED",
            latestExecutedAt: new Date("2026-10-30T09:00:00.000Z"),
            latestCommitSha: "f".repeat(40),
            approvedBy: "Dana Scully",
            approvedAt: new Date("2026-10-29T09:00:00.000Z"),
            authoredByAgent: null,
            signal: "STABLE",
          },
        ],
      }),
    );

    expect(html).toContain("Approved tests not linked to a requirement");
    expect(html).toContain("The checkout page loads");
    // The claim and its limit in the same breath: a reader must not have to
    // infer that a passing test nobody tied to a requirement proves intent.
    expect(html).toContain("not linked to an approved requirement");
    expect(html).toContain("evidence of how the product behaves");
  });

  it("says nothing about unlinked tests when there are none", () => {
    expect(evidenceDocument(report())).not.toContain("not linked to a requirement");
  });
});
