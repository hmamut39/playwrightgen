import "server-only";

import {
  requireWorkspaceContext,
  type WorkspaceContextDependencies,
} from "@/lib/auth/workspace-context";
import type { PrismaClient } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { freshnessFor, type EvidenceFreshness } from "@/lib/services/project-quality";
import { classifyRuns, loadAttemptFacts } from "@/lib/services/run-signals";

/**
 * The evidence behind a release, assembled per requirement.
 *
 * Every other view answers a question about one record. This answers the
 * question somebody actually has to sign their name to: for each thing we said
 * the product should do, what verifies it, when did that last run, and what
 * happened. Without it the answer lives in one person's memory of several
 * screens, which is precisely the thing an audit cannot accept and a release
 * meeting cannot check.
 *
 * The verdict per requirement is deliberately blunt and derived only from
 * stored records:
 *
 *   VERIFIED    an approved Test Case exists and its most recent attempt passed
 *   FAILING     an approved Test Case exists and its most recent attempt failed
 *   UNVERIFIED  nothing approved covers it, or nothing has ever run
 *
 * Drafts never count. A proposed or in-review Test Case describes coverage
 * somebody intends to have; treating it as coverage would let a requirement
 * read as verified because a test was written, not because it ran and passed.
 */

/** Bounded so a large project produces a report rather than a timeout. */
const REQUIREMENT_CAP = 500;

export type RequirementVerdict = "VERIFIED" | "FAILING" | "UNVERIFIED";

export type EvidenceTestCase = {
  id: string;
  title: string;
  status: string;
  versionNumber: number;
  latestResult: "PASSED" | "FAILED" | "BLOCKED" | "SKIPPED" | null;
  latestExecutedAt: Date | null;
  /**
   * Who approved it, and when.
   *
   * The chain already said who proposed a test and that it ran and passed.
   * The part a reviewing body actually asks for was missing: the sign-off
   * record naming who accepted each artifact and when.
   *
   * The two come from different places, deliberately. The time is on the
   * record, where approving sets it and sending the artifact back to review
   * clears it, so it is the approval that stands rather than the last one
   * that ever happened. The name is read back from the append-only trail,
   * which is the only place it is kept -- and it can be missing when the
   * name is older than the window read, so a reader is told that an artifact
   * was approved even when nobody can be named for it.
   */
  approvedBy: string | null;
  approvedAt: Date | null;
  latestCommitSha: string | null;
  /**
   * Which assistant proposed this test, when one did and said who it was.
   *
   * Evidence that says only "an AI wrote it" answers half the question a
   * reviewer or an auditor is actually asking. Naming the tool costs nothing
   * here and is what traceability for AI-assisted work is now expected to
   * carry; it is the caller's own claim, and a person still approved it.
   */
  authoredByAgent: string | null;
  signal: string | null;
};

export type EvidenceRequirement = {
  id: string;
  title: string;
  status: string;
  versionNumber: number;
  externalReference: string | null;
  verdict: RequirementVerdict;
  /** Why the verdict is what it is, in one sentence a reader can check. */
  reason: string;
  /**
   * When this requirement was last exercised at all, and how old that is.
   *
   * A verdict alone is not evidence. "Verified" by a run from two hundred days
   * ago reads exactly like "verified" this morning, and the difference is the
   * whole question an auditor is asking. The age travels with the verdict so
   * nobody has to work it out.
   */
  lastVerifiedAt: Date | null;
  ageDays: number | null;
  freshness: EvidenceFreshness;
  /** Who approved this requirement, and when. */
  approvedBy: string | null;
  approvedAt: Date | null;
  /**
   * How many acceptance criteria the requirement states.
   *
   * A requirement is called verified when an approved test last ran and
   * passed -- any one of them. A requirement with six criteria and one passing
   * test therefore reads exactly like one with six criteria and six. Nothing
   * in the records says which criteria a test covers, so this does not claim
   * to: it reports the number, and the reason says plainly that the mapping is
   * not recorded. A reader can then see thin coverage instead of being told
   * everything is fine.
   */
  criteriaCount: number;
  testCases: EvidenceTestCase[];
};

export type ReleaseEvidenceReport = {
  project: { id: string; name: string; slug: string };
  organization: { name: string; slug: string };
  generatedAt: Date;
  requirements: EvidenceRequirement[];
  /**
   * Approved tests that verify no requirement, with how each last ran.
   *
   * Kept beside `requirements` rather than folded into them: these prove
   * behaviour, not intent anybody agreed to, and a reader has to be able to
   * tell which is which. They exist so a project can show what it has before
   * it has written requirements -- which is exactly where "Cover a page"
   * leaves a team.
   */
  unlinkedTests: EvidenceTestCase[];
  totals: {
    verified: number;
    failing: number;
    unverified: number;
    /** Verified, but by evidence older than a month. Counted, not hidden. */
    stale: number;
  };
  truncated: boolean;
  /**
   * How many requirements this report describes, and how many the project
   * has.
   *
   * `truncated` said that something was missing and nothing said how much,
   * which left every surface either silent or vague. A reader deciding on a
   * release needs the size of what they are not being shown.
   */
  coverage: { shown: number; total: number };
};

export async function getReleaseEvidenceReport(
  input: { projectId: string; orgSlug?: string; now?: Date },
  dependencies?: WorkspaceContextDependencies,
): Promise<ReleaseEvidenceReport> {
  const workspace = await requireWorkspaceContext(
    { orgSlug: input.orgSlug, projectId: input.projectId, permission: "testrun:read" },
    dependencies,
  );
  return buildReleaseEvidenceReport({
    organizationId: workspace.organization.id,
    projectId: input.projectId,
    now: input.now,
    prisma: dependencies?.prisma,
  });
}

/**
 * The report itself, from ids rather than a session.
 *
 * A shared proof link carries its own authorization (a signed token naming one
 * project), so the same report is built here without a workspace context. The
 * caller decides who may see it; this only reads.
 */
/**
 * What approved tests that verify no requirement do and do not prove.
 *
 * Written once because three surfaces say it -- the shared page, the kept
 * file and the workspace report -- and a sentence this load-bearing must not
 * drift between them.
 *
 * The first draft of it said these tests "have run against the real site, so
 * their results are evidence of how the product behaves". Nothing guarantees
 * that. A project can reach four approved tests and no recorded run at all,
 * which is where "Cover a page" leaves a team that has not wired up their
 * pipeline yet -- and that sentence would have gone to an outsider asserting
 * runs that never happened. Approving a test records an intention to check
 * something. It does not check it.
 */
export function unlinkedTestsNote(tests: Pick<EvidenceTestCase, "latestResult">[]) {
  const ran = tests.filter((testCase) => testCase.latestResult !== null).length;
  const never = tests.length - ran;
  const one = tests.length === 1;
  const subject = one ? "This test is" : `These ${tests.length} tests are`;

  if (ran === 0) {
    // "it has ever run" was the first attempt at the singular, which says the
    // opposite of what it means. Northwind has exactly one such test, so that
    // is the sentence its page would have carried.
    return `${subject} approved, and ${one ? "it has never run" : "none of them has ever run"}, so nothing here shows how the product behaves.`;
  }

  const behaviour =
    never === 0
      ? `${subject} approved and ${one ? "has" : "have"} run against the real site, so ${one ? "its result is" : "their results are"} evidence of how the product behaves.`
      : `${subject} approved. ${ran === 1 ? "One of them has" : `${ran} of them have`} run against the real site, so ${ran === 1 ? "that result is" : "those results are"} evidence of how the product behaves; ${never === 1 ? "one has" : `${never} have`} never run, and ${never === 1 ? "it shows" : "they show"} only that the team approved ${never === 1 ? "it" : "them"}.`;

  const intent = one
    ? " It is not linked to an approved requirement, so it does not show that the behaviour is what anyone agreed it should be."
    : " None is linked to an approved requirement, so none shows that the behaviour is what anyone agreed it should be.";

  return behaviour + intent;
}

export async function buildReleaseEvidenceReport(input: {
  organizationId: string;
  projectId: string;
  now?: Date;
  prisma?: PrismaClient;
}): Promise<ReleaseEvidenceReport> {
  const prisma = input.prisma ?? getPrismaClient();
  const organizationId = input.organizationId;
  const projectId = input.projectId;
  const now = input.now ?? new Date();

  const organization = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true, slug: true },
  });
  const [project, requirements, requirementTotal, unlinkedTestCases, attemptFacts, approvalActivity] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { organizationId_id: { organizationId, id: projectId } },
      select: { id: true, name: true, slug: true },
    }),
    prisma.requirement.findMany({
      where: { organizationId, projectId, status: { not: "ARCHIVED" } },
      orderBy: [{ status: "asc" }, { title: "asc" }],
      take: REQUIREMENT_CAP + 1,
      select: {
        id: true,
        title: true,
        status: true,
        currentVersionNumber: true,
        acceptanceCriteria: true,
        externalReference: true,
        // Set when it was approved and cleared when it goes back to review,
        // so this is the approval that stands.
        approvedAt: true,
        testCaseLinks: {
          select: {
            testCase: {
              select: {
                id: true,
                title: true,
                status: true,
                currentVersionNumber: true,
                approvedAt: true,
                // Version 1 is the proposal: who wrote it does not change when
                // the Test Case is edited later.
                versions: {
                  where: { versionNumber: 1 },
                  select: { authoredByAgent: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    }),
    // How many there really are. The report is capped so a large project
    // produces a report rather than a timeout, and a reader deciding on a
    // release needs the size of what they are not being shown.
    prisma.requirement.count({
      where: { organizationId, projectId, status: { not: "ARCHIVED" } },
    }),
    /**
     * The report was organised entirely by requirement, so a project that
     * reached approved, proven tests through "Cover a page" -- the product's
     * own first suggestion, which produces test cases and no requirement --
     * had nothing it could show anybody, and sharing was gated shut for that
     * reason: a link to an empty page tells a manager the team has nothing
     * rather than that they have not finished.
     *
     * The gate was right about the empty page and wrong about the emptiness.
     * Approved tests that ran on the live site are evidence. They are simply
     * not evidence about a requirement, so they are carried separately and
     * labelled as what they are, instead of being withheld until somebody
     * writes the requirement nobody told them they needed.
     */
    prisma.testCase.findMany({
      where: {
        organizationId,
        projectId,
        status: "APPROVED",
        requirementLinks: { none: {} },
      },
      orderBy: { title: "asc" },
      take: REQUIREMENT_CAP,
      select: {
        id: true,
        title: true,
        status: true,
        currentVersionNumber: true,
        approvedAt: true,
        versions: { where: { versionNumber: 1 }, select: { authoredByAgent: true }, take: 1 },
      },
    }),
    loadAttemptFacts(prisma, { organizationId, projectId }),
    // The name behind each sign-off. The fact and its time come from the
    // artifact itself; this trail is the only place the person is recorded,
    // and it is read newest-first so the entry kept per artifact is the most
    // recent one. A project with more approval events than this window holds
    // loses the oldest names -- which now costs a name and not the approval,
    // because an artifact that says nothing about who approved it still says
    // that it was approved and when.
    prisma.activity.findMany({
      where: {
        organizationId,
        projectId,
        action: { in: ["REQUIREMENT_APPROVED", "TEST_CASE_APPROVED"] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { targetId: true, createdAt: true, actor: { select: { displayName: true } } },
      take: 2_000,
    }),
  ]);
  const approvedByName = new Map<string, string | null>();
  for (const approval of approvalActivity) {
    if (!approvedByName.has(approval.targetId)) {
      approvedByName.set(approval.targetId, approval.actor?.displayName ?? null);
    }
  }

  const signals = classifyRuns(attemptFacts);

  // The most recent attempt per Test Case, and the verdict of the run it
  // belongs to. Ordering by execution time rather than attempt number because
  // a Test Case can be exercised by more than one run.
  const latestByTestCase = new Map<string, (typeof attemptFacts)[number]>();
  for (const fact of attemptFacts) {
    const current = latestByTestCase.get(fact.testCaseId);
    if (!current || fact.executedAt > current.executedAt) {
      latestByTestCase.set(fact.testCaseId, fact);
    }
  }

  const evidence: EvidenceRequirement[] = requirements
    .slice(0, REQUIREMENT_CAP)
    .map((requirement) => {
      const testCases: EvidenceTestCase[] = requirement.testCaseLinks.map((link) => {
        const latest = latestByTestCase.get(link.testCase.id) ?? null;
        return {
          id: link.testCase.id,
          title: link.testCase.title,
          status: link.testCase.status,
          versionNumber: link.testCase.currentVersionNumber,
          latestResult: latest?.result ?? null,
          latestExecutedAt: latest?.executedAt ?? null,
          latestCommitSha: latest?.commitSha ?? null,
          // A name without a standing approval is a contradiction, and the
          // next surface to read it would state it.
          approvedBy: link.testCase.approvedAt ? approvedByName.get(link.testCase.id) ?? null : null,
          approvedAt: link.testCase.approvedAt,
          authoredByAgent: link.testCase.versions[0]?.authoredByAgent ?? null,
          signal: latest ? (signals.get(latest.testRunId)?.signal ?? null) : null,
        };
      });

      const criteriaCount = requirement.acceptanceCriteria
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean).length;
      const approved = testCases.filter((testCase) => testCase.status === "APPROVED");
      const executed = approved.filter((testCase) => testCase.latestResult !== null);
      const passing = executed.filter((testCase) => testCase.latestResult === "PASSED");
      // A test that was skipped or blocked did not fail: it never got as far
      // as the behaviour. Calling that "did not pass" sends a team looking
      // for a product defect when what is missing is a URL or a secret in
      // the pipeline -- and the line beneath it already says "could not run",
      // so the page contradicted itself.
      const blocked = executed.filter(
        (testCase) => testCase.latestResult === "BLOCKED" || testCase.latestResult === "SKIPPED",
      );
      const failing = executed.filter((testCase) => testCase.latestResult === "FAILED");

      // Approved coverage that has never executed. A verdict drawn from the
      // tests that ran, with nothing said about the ones that did not, reads
      // as the whole story to somebody outside the team -- and on a VERIFIED
      // requirement it reads as reassurance it has not earned.
      const neverRan = approved.length - executed.length;
      const neverRanNote =
        neverRan > 0
          ? ` ${neverRan} more approved test${neverRan === 1 ? " has" : "s have"} never run.`
          : "";
      const blockedNote =
        blocked.length > 0
          ? ` ${blocked.length} approved test${blocked.length === 1 ? " was skipped or could not run" : "s were skipped or could not run"} on the last attempt.`
          : "";

      let verdict: RequirementVerdict;
      let reason: string;
      if (failing.length > 0) {
        verdict = "FAILING";
        reason = `${failing.length} approved test${failing.length === 1 ? "" : "s"} last ran and did not pass.${blockedNote}${neverRanNote}`;
      } else if (passing.length > 0) {
        verdict = "VERIFIED";
        // A passing test that has also failed on this same approved version.
        // The signal was computed for every test case here and shown to
        // nobody, so a requirement could be headed VERIFIED on the strength of
        // a run the workspace already knew was not reproducible. The verdict
        // stands -- the last run did pass -- but a reader deciding whether to
        // accept this needs the same doubt the team has.
        const unreliable = passing.filter((testCase) => testCase.signal === "FLAKY").length;
        const unreliableNote =
          unreliable > 0
            ? ` ${unreliable === 1 ? "One of them has" : `${unreliable} of them have`} also failed on this version, so ${unreliable === 1 ? "that result is" : "those results are"} not reproducible.`
            : "";
        reason = `${passing.length} approved test${passing.length === 1 ? "" : "s"} last ran and passed.${unreliableNote}${blockedNote}${neverRanNote}`;
        // Said out loud rather than left for a reader to assume: one passing
        // test does not mean six criteria were each checked.
        if (criteriaCount > passing.length) {
          reason += ` This requirement states ${criteriaCount} acceptance criteria, and the records do not say which of them those tests cover.`;
        }
      } else if (blocked.length > 0) {
        // The pipeline ran and proved nothing. That is not a failing
        // requirement and it is certainly not a verified one.
        verdict = "UNVERIFIED";
        reason = `${blocked.length} approved test${blocked.length === 1 ? " was skipped or could not run" : "s were skipped or could not run"} on the last attempt, so nothing demonstrates the behaviour. A skipped test is usually waiting on something the run did not have, such as an address or a credential.${neverRanNote}`;
      } else if (approved.length > 0) {
        verdict = "UNVERIFIED";
        reason =
          "An approved test covers this, but it has never run, so nothing demonstrates the behaviour.";
      } else if (testCases.length > 0) {
        verdict = "UNVERIFIED";
        reason =
          "Every test covering this is still a draft. Intended coverage is not coverage until it is approved.";
      } else {
        verdict = "UNVERIFIED";
        reason = "Nothing is linked to this requirement, so nothing verifies it.";
      }

      const executedAt = executed
        .map((testCase) => testCase.latestExecutedAt?.getTime())
        .filter((time): time is number => typeof time === "number");
      const lastVerifiedAt = executedAt.length ? new Date(Math.max(...executedAt)) : null;
      const age = freshnessFor(lastVerifiedAt, now);

      return {
        id: requirement.id,
        title: requirement.title,
        status: requirement.status,
        versionNumber: requirement.currentVersionNumber,
        externalReference: requirement.externalReference,
        verdict,
        reason,
        lastVerifiedAt,
        ageDays: age.ageDays,
        freshness: age.freshness,
        approvedBy: requirement.approvedAt ? approvedByName.get(requirement.id) ?? null : null,
        approvedAt: requirement.approvedAt,
        criteriaCount,
        testCases,
      };
    });

  // The same shape as a requirement's own test rows, so every surface that
  // can already render one needs no new vocabulary to render these.
  const unlinkedTests: EvidenceTestCase[] = unlinkedTestCases.map((testCase) => {
    const latest = latestByTestCase.get(testCase.id) ?? null;
    return {
      id: testCase.id,
      title: testCase.title,
      status: testCase.status,
      versionNumber: testCase.currentVersionNumber,
      latestResult: latest?.result ?? null,
      latestExecutedAt: latest?.executedAt ?? null,
      latestCommitSha: latest?.commitSha ?? null,
      approvedBy: testCase.approvedAt ? approvedByName.get(testCase.id) ?? null : null,
      approvedAt: testCase.approvedAt,
      authoredByAgent: testCase.versions[0]?.authoredByAgent ?? null,
      signal: latest ? (signals.get(latest.testRunId)?.signal ?? null) : null,
    };
  });

  return {
    project,
    unlinkedTests,
    organization: { name: organization.name, slug: organization.slug },
    generatedAt: now,
    requirements: evidence,
    totals: {
      stale: evidence.filter((item) => item.verdict === "VERIFIED" && item.freshness === "STALE").length,
      verified: evidence.filter((item) => item.verdict === "VERIFIED").length,
      failing: evidence.filter((item) => item.verdict === "FAILING").length,
      unverified: evidence.filter((item) => item.verdict === "UNVERIFIED").length,
    },
    truncated: requirements.length > REQUIREMENT_CAP,
    coverage: { shown: evidence.length, total: requirementTotal },
  };
}
