import type {
  EvidenceRequirement,
  EvidenceTestCase,
  ReleaseEvidenceReport,
  RequirementVerdict,
} from "@/lib/services/release-evidence";

/**
 * What changed since a snapshot was taken.
 *
 * A frozen proof link answers "what was true on the 20th". The question a team
 * asks next is the harder one: what has moved since. Without it, a snapshot is
 * a record nobody reads again; with it, the snapshot becomes the baseline a
 * release is measured against.
 *
 * The comparison is made from the two reports and nothing else. It states only
 * what the records differ on -- a requirement that appeared, one that is gone,
 * a verdict that moved -- and never guesses at a cause. A verdict that went
 * from verified to failing is reported as exactly that, not as a regression,
 * because the records cannot tell the difference between a broken product and
 * a test that was changed.
 */

export type VerdictMove = {
  id: string;
  title: string;
  from: RequirementVerdict;
  to: RequirementVerdict;
  /** True when the move is one a release decision should stop for. */
  worse: boolean;
};

/**
 * How an approved test that verifies no requirement last ran, then and now.
 *
 * These carry no verdict, because a verdict is a statement about a
 * requirement. What they carry is a result, and a result that went from
 * passing to failing is the thing a reader of this page most needs told.
 */
export type TestResultMove = {
  id: string;
  title: string;
  from: EvidenceTestCase["latestResult"];
  to: EvidenceTestCase["latestResult"];
  /** True when it was passing and now is not. */
  worse: boolean;
};

export type EvidenceChange = {
  added: Array<{ id: string; title: string; verdict: RequirementVerdict }>;
  removed: Array<{ id: string; title: string; verdict: RequirementVerdict }>;
  moved: VerdictMove[];
  unchanged: number;
  /**
   * Approved tests that verify no requirement.
   *
   * The snapshot shows these, so the comparison has to account for them. It
   * did not, and the consequence was precise: a test could go from passing to
   * failing on a page a manager is reading and this one still said "nothing
   * has changed since this snapshot was taken". True of the requirements, and
   * doing the work of a false sentence.
   */
  tests: {
    added: Array<{ id: string; title: string }>;
    removed: Array<{ id: string; title: string }>;
    moved: TestResultMove[];
  };
  /** True when nothing at all differs. */
  same: boolean;
};

/** Verified is better than not verified, which is better than failing. */
const RANK: Record<RequirementVerdict, number> = { VERIFIED: 2, UNVERIFIED: 1, FAILING: 0 };

export const VERDICT_WORD: Record<RequirementVerdict, string> = {
  VERIFIED: "verified",
  FAILING: "failing",
  UNVERIFIED: "not verified",
};

const brief = (requirement: EvidenceRequirement) => ({
  id: requirement.id,
  title: requirement.title,
  verdict: requirement.verdict,
});

export function compareEvidence(before: ReleaseEvidenceReport, after: ReleaseEvidenceReport): EvidenceChange {
  const then = new Map(before.requirements.map((requirement) => [requirement.id, requirement]));
  const now = new Map(after.requirements.map((requirement) => [requirement.id, requirement]));

  const added = after.requirements.filter((requirement) => !then.has(requirement.id)).map(brief);
  const removed = before.requirements.filter((requirement) => !now.has(requirement.id)).map(brief);

  const moved: VerdictMove[] = [];
  let unchanged = 0;
  for (const [id, was] of then) {
    const is = now.get(id);
    if (!is) continue;
    if (is.verdict === was.verdict) {
      unchanged += 1;
      continue;
    }
    moved.push({
      id,
      title: is.title,
      from: was.verdict,
      to: is.verdict,
      worse: RANK[is.verdict] < RANK[was.verdict],
    });
  }
  // Worst news first: a release decision reads the top of the list.
  moved.sort((left, right) => Number(right.worse) - Number(left.worse) || left.title.localeCompare(right.title));

  // The same comparison for the tests that verify no requirement. A snapshot
  // kept before the report carried them has none, which reads as "nothing was
  // recorded" rather than as every current test being new -- the alternative
  // would announce a dozen additions the day this shipped.
  const testsThen = new Map(before.unlinkedTests.map((testCase) => [testCase.id, testCase]));
  const testsNow = new Map(after.unlinkedTests.map((testCase) => [testCase.id, testCase]));
  const name = (testCase: EvidenceTestCase) => ({ id: testCase.id, title: testCase.title });

  const testsMoved: TestResultMove[] = [];
  for (const [id, was] of testsThen) {
    const is = testsNow.get(id);
    if (!is || is.latestResult === was.latestResult) continue;
    testsMoved.push({
      id,
      title: is.title,
      from: was.latestResult,
      to: is.latestResult,
      // Anything other than a pass is worse than a pass, including a test
      // that stopped running at all: a result that went missing is not good
      // news, and calling it an improvement would be the lie this avoids.
      worse: was.latestResult === "PASSED" && is.latestResult !== "PASSED",
    });
  }
  testsMoved.sort(
    (left, right) => Number(right.worse) - Number(left.worse) || left.title.localeCompare(right.title),
  );

  const tests = {
    added: after.unlinkedTests.filter((testCase) => !testsThen.has(testCase.id)).map(name),
    removed: before.unlinkedTests.filter((testCase) => !testsNow.has(testCase.id)).map(name),
    moved: testsMoved,
  };

  return {
    added,
    removed,
    moved,
    unchanged,
    tests,
    same:
      added.length === 0 &&
      removed.length === 0 &&
      moved.length === 0 &&
      tests.added.length === 0 &&
      tests.removed.length === 0 &&
      tests.moved.length === 0,
  };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * One sentence a person can read without opening anything else. It leads with
 * what got worse, because that is the only part that can stop a release.
 */
export function changeSummary(change: EvidenceChange): string {
  if (change.same) return "Nothing has changed since this snapshot was taken.";

  const worse = change.moved.filter((move) => move.worse);
  const better = change.moved.filter((move) => !move.worse);
  const parts: string[] = [];
  if (worse.length) parts.push(`${count(worse.length, "requirement", "requirements")} got worse`);
  if (better.length) parts.push(`${count(better.length, "requirement", "requirements")} improved`);
  if (change.added.length) parts.push(`${count(change.added.length, "requirement was", "requirements were")} added`);
  if (change.removed.length) {
    parts.push(`${count(change.removed.length, "requirement is", "requirements are")} gone`);
  }

  /*
   * Then the tests that verify no requirement, named as what they are.
   *
   * Said in the same sentence rather than a second one, because a reader who
   * stops after the first sentence has to have been told the worst of it.
   * "A test" and "a requirement" are kept distinct throughout: a reader
   * deciding whether to accept this needs to know which kind of thing moved.
   */
  const testsWorse = change.tests.moved.filter((move) => move.worse);
  const testsBetter = change.tests.moved.filter((move) => !move.worse);
  if (testsWorse.length) {
    parts.push(`${count(testsWorse.length, "unlinked test", "unlinked tests")} stopped passing`);
  }
  if (testsBetter.length) {
    parts.push(`${count(testsBetter.length, "unlinked test", "unlinked tests")} last ran differently`);
  }
  if (change.tests.added.length) {
    parts.push(`${count(change.tests.added.length, "unlinked test was", "unlinked tests were")} added`);
  }
  if (change.tests.removed.length) {
    parts.push(`${count(change.tests.removed.length, "unlinked test is", "unlinked tests are")} gone`);
  }

  const sentence =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const tail = change.unchanged ? ` ${count(change.unchanged, "requirement is", "requirements are")} unchanged.` : "";
  return `Since this snapshot, ${sentence}.${tail}`;
}
