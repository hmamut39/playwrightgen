import type {
  EvidenceRequirement,
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

export type EvidenceChange = {
  added: Array<{ id: string; title: string; verdict: RequirementVerdict }>;
  removed: Array<{ id: string; title: string; verdict: RequirementVerdict }>;
  moved: VerdictMove[];
  unchanged: number;
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

  return {
    added,
    removed,
    moved,
    unchanged,
    same: added.length === 0 && removed.length === 0 && moved.length === 0,
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

  const sentence =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  const tail = change.unchanged ? ` ${count(change.unchanged, "requirement is", "requirements are")} unchanged.` : "";
  return `Since this snapshot, ${sentence}.${tail}`;
}
