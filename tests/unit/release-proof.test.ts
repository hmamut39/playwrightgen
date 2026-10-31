import { createHmac, randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { readProofToken, readSnapshot } from "@/lib/services/release-proof";

/**
 * The token is the whole authorization for a shared proof link, so what it
 * refuses matters more than what it accepts.
 */
const SECRET = "proof-link-test-secret-with-enough-length";

beforeAll(() => {
  process.env.RUNNER_INGEST_SECRET = SECRET;
});

// Built the way the service builds one, so the test does not depend on a
// private helper.
function mint(claim: Record<string, unknown>, secret = SECRET) {
  const body = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return `pwgp1.${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

const claim = () => ({
  projectId: randomUUID(),
  organizationId: randomUUID(),
  issuedAt: Date.now() - 1_000,
  expiresAt: Date.now() + 60_000,
});

describe("a shared proof link's token", () => {
  it("names exactly one project, and nothing else", () => {
    const wanted = claim();
    const read = readProofToken(mint(wanted));
    expect(read).toEqual(wanted);
    expect(Object.keys(read ?? {}).sort()).toEqual(["expiresAt", "issuedAt", "organizationId", "projectId"]);
  });

  it("refuses a token that was edited, signed with another secret, or is not ours", () => {
    const token = mint(claim());
    const [prefix, body, signature] = token.split(".");
    // A different project, same signature.
    const swapped = Buffer.from(JSON.stringify(claim())).toString("base64url");
    expect(readProofToken(`${prefix}.${swapped}.${signature}`)).toBeNull();
    // A signature from someone else's secret.
    expect(readProofToken(mint(claim(), "another-secret-entirely-long-enough"))).toBeNull();
    // Shapes that are not tokens at all.
    expect(readProofToken("")).toBeNull();
    expect(readProofToken(`pwgp1.${body}`)).toBeNull();
    expect(readProofToken(`other.${body}.${signature}`)).toBeNull();
    expect(readProofToken(`pwgp1.not-base64url!!.${signature}`)).toBeNull();
  });

  it("stops working when it expires", () => {
    const expiring = { ...claim(), expiresAt: Date.now() + 5_000 };
    const token = mint(expiring);
    expect(readProofToken(token)).not.toBeNull();
    expect(readProofToken(token, new Date(Date.now() + 10_000))).toBeNull();
  });

  it("refuses a claim missing what it must name", () => {
    expect(readProofToken(mint({ projectId: randomUUID(), expiresAt: Date.now() + 60_000 }))).toBeNull();
    expect(readProofToken(mint({ ...claim(), projectId: "not-a-uuid" }))).toBeNull();
  });
});

/**
 * A frozen link keeps the report as JSON, so every snapshot taken before a
 * field existed is missing it -- while the type says it is there. Three such
 * snapshots were already shared when approved tests that verify no
 * requirement were added to the report, and the page reads that list's
 * length, so each of those links would have thrown on open.
 */
describe("a snapshot kept before the report carried unlinked tests", () => {
  const stored = (extra: Record<string, unknown> = {}) => ({
    project: { id: "p1", name: "Shop", slug: "shop" },
    organization: { name: "Acme", slug: "acme" },
    generatedAt: "2026-10-20T09:00:00.000Z",
    requirements: [],
    totals: { verified: 0, failing: 0, unverified: 0, stale: 0 },
    truncated: false,
    coverage: { shown: 0, total: 0 },
    ...extra,
  });

  it("opens, with nothing claimed either way about unlinked tests", () => {
    const revived = readSnapshot(stored());

    expect(revived).not.toBeNull();
    expect(revived!.unlinkedTests).toEqual([]);
  });

  it("revives the dates on a snapshot that does carry them", () => {
    const revived = readSnapshot(
      stored({
        unlinkedTests: [
          {
            id: "t1",
            title: "The checkout page loads",
            status: "APPROVED",
            versionNumber: 1,
            latestResult: "PASSED",
            latestExecutedAt: "2026-10-19T09:00:00.000Z",
            approvedBy: "Dana Scully",
            approvedAt: "2026-10-18T09:00:00.000Z",
            latestCommitSha: null,
            authoredByAgent: null,
            signal: "STABLE",
          },
        ],
      }),
    );

    // JSON has no dates. A string here reaches a page that calls date methods
    // on it, which is the same crash one field further along.
    expect(revived!.unlinkedTests[0].latestExecutedAt).toBeInstanceOf(Date);
    expect(revived!.unlinkedTests[0].approvedAt).toBeInstanceOf(Date);
    expect(revived!.unlinkedTests[0].title).toBe("The checkout page loads");
  });
});
