import { createHmac, randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import {
  badgeMessage,
  badgeSvg,
  badgeTokenFor,
  readBadgeState,
  readBadgeToken,
} from "@/lib/services/evidence-badge";

/**
 * A badge goes in a public README, so the question is not what it shows but
 * what it gives away and what it accepts.
 */
const SECRET = "badge-test-secret-with-enough-length-here";

beforeAll(() => {
  process.env.RUNNER_INGEST_SECRET = SECRET;
});

function proofToken(expiresAt = Date.now() + 60_000, projectId = randomUUID()) {
  const body = Buffer.from(
    JSON.stringify({
      projectId,
      organizationId: randomUUID(),
      issuedAt: Date.now() - 1_000,
      expiresAt,
    }),
  ).toString("base64url");
  return `pwgp1.${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}

describe("a badge token", () => {
  it("is readable back, and expires with the link it came from", () => {
    const expiresAt = Date.now() + 60_000;
    const token = badgeTokenFor(proofToken(expiresAt));
    const claim = readBadgeToken(token!);
    expect(claim?.expiresAt).toBe(expiresAt);
    expect(readBadgeToken(token!, new Date(expiresAt + 1))).toBeNull();
  });

  it("never carries the proof token it was made from", () => {
    const proof = proofToken();
    const token = badgeTokenFor(proof)!;
    expect(token).not.toContain(proof.split(".")[1]);
    const body = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    // Only the hash travels, so a README cannot be read back into a link.
    expect(body.proofHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(body)).not.toContain(proof);
    expect(body.organizationId).toBeUndefined();
  });

  it("refuses a proof token we did not sign", () => {
    const proof = proofToken();
    expect(badgeTokenFor(`${proof}x`)).toBeNull();
    expect(badgeTokenFor(proofToken(Date.now() - 1))).toBeNull();
  });

  it("refuses a badge token that was edited, re-prefixed or re-signed", () => {
    const token = badgeTokenFor(proofToken())!;
    const [prefix, body, signature] = token.split(".");
    expect(readBadgeToken(`${prefix}.${body}x.${signature}`)).toBeNull();
    expect(readBadgeToken(`${prefix}.${body}.${signature}x`)).toBeNull();
    expect(readBadgeToken(`pwgp1.${body}.${signature}`)).toBeNull();
    expect(readBadgeToken(body)).toBeNull();
    // A proof token signed with the same secret is not a badge token: the two
    // signatures are over different strings.
    expect(readBadgeToken(proofToken().replace("pwgp1", "pwgb1"))).toBeNull();
  });
});

describe("what the badge says", () => {
  it("counts verified requirements, and leads with failure when there is any", () => {
    expect(badgeMessage({ kind: "verified", verified: 12, total: 12, partial: false })).toBe(
      "12 of 12 verified",
    );
    expect(badgeMessage({ kind: "failing", failing: 2, partial: false })).toBe("2 failing");
    // Green on month-old evidence would be the same lie the page used to tell.
    expect(
      badgeMessage({ kind: "stale", verified: 8, total: 12, stale: 3, partial: false }),
    ).toBe("8 of 12 verified, 3 stale");
    expect(badgeMessage({ kind: "unverified" })).toBe("none verified");
    expect(badgeMessage({ kind: "empty" })).toBe("no requirements");
    expect(badgeMessage({ kind: "unavailable" })).toBe("unavailable");
  });

  it("will not stand behind a snapshot link", async () => {
    // A badge is a standing claim in a README, read in the present tense by
    // people who never open the link behind it. A snapshot's numbers were
    // true on the day it was made and can never move, so a project that broke
    // the next morning would keep a green "12 of 12 verified" until the link
    // expired -- a badge that cannot go stale, fail or empty.
    // As the column holds it: JSON, with the date as a string. A Date here
    // is rejected by the reader, and the test would then pass because the
    // snapshot was unreadable rather than because it was refused.
    const frozen = {
      generatedAt: "2026-10-01T09:00:00.000Z",
      project: { id: "p1", name: "Shop", slug: "shop" },
      organization: { name: "Acme", slug: "acme" },
      totals: { verified: 12, failing: 0, unverified: 0, stale: 0 },
      truncated: false,
      coverage: { shown: 12, total: 12 },
      requirements: [],
    };
    const projectId = randomUUID();
    const state = await readBadgeState(badgeTokenFor(proofToken(Date.now() + 60_000, projectId)) as string, {
      prisma: {
        proofLink: {
          findUnique: async () => ({
            revokedAt: null,
            expiresAt: new Date("2099-01-01T00:00:00.000Z"),
            projectId,
            organizationId: "o1",
            snapshot: frozen,
          }),
        },
      } as never,
      now: new Date("2026-10-18T09:00:00.000Z"),
    });

    expect(state).toEqual({ kind: "unavailable" });
    expect(badgeMessage(state)).toBe("unavailable");
  });

  it("never reads a capped report as the whole project", () => {
    // The report is bounded so that a large project produces a report at all.
    // A badge in a README reading "480 of 500 verified" for a project with
    // nine hundred requirements is the same overstatement as green on stale
    // evidence, in a place strangers read.
    expect(
      badgeMessage({ kind: "verified", verified: 480, total: 500, partial: true }),
    ).toBe("480 of first 500 verified");
    expect(
      badgeMessage({ kind: "stale", verified: 480, total: 500, stale: 7, partial: true }),
    ).toBe("480 of first 500 verified, 7 stale");
    // At least this many: more may fail beyond what was read.
    expect(badgeMessage({ kind: "failing", failing: 2, partial: true })).toBe("2+ failing");
  });

  it("is an image whatever happened, so a README never shows a broken one", () => {
    for (const state of [
      { kind: "verified", verified: 3, total: 4, partial: false },
      { kind: "verified", verified: 3, total: 4, partial: true },
      { kind: "failing", failing: 1, partial: false },
      { kind: "unavailable" },
    ] as const) {
      const svg = badgeSvg(state);
      expect(svg.startsWith("<svg xmlns=")).toBe(true);
      expect(svg).toContain(badgeMessage(state));
      expect(svg).toContain("requirements");
    }
  });

  it("colours failure red and success green, so it reads at a glance", () => {
    expect(badgeSvg({ kind: "failing", failing: 1, partial: false })).toContain("#dc2626");
    expect(badgeSvg({ kind: "verified", verified: 1, total: 1, partial: false })).toContain("#16a34a");
    expect(badgeSvg({ kind: "unavailable" })).toContain("#94a3b8");
    expect(badgeSvg({ kind: "stale", verified: 1, total: 1, stale: 1, partial: false })).toContain("#b45309");
  });

  it("grows with its text, so the message is never clipped", () => {
    const narrow = badgeSvg({ kind: "failing", failing: 1, partial: false });
    const wide = badgeSvg({ kind: "verified", verified: 100, total: 100, partial: false });
    const widthOf = (svg: string) => Number(/width="(\d+)"/.exec(svg)![1]);
    expect(widthOf(wide)).toBeGreaterThan(widthOf(narrow));
  });
});
