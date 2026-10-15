import { OrganizationAiRateLimitError } from "@/lib/operations/organization-ai-guard";
import { waitLabel } from "@/lib/wait-label";

/**
 * One fact, said the same way wherever a person meets it: this workspace has
 * no AI requests left right now, and here is when it will.
 *
 * Found by using the product on a workspace that had spent its allowance.
 * Five surfaces knew what had happened and told the person five different
 * things: a crash page offering to "try again" (it would not work for an
 * hour), "It could not be read just now", "The model could not be reached"
 * (it was never asked), a branch testing a code nothing throws, and one
 * correct notice. The guard knows the reason and the seconds; every surface
 * reads it from here instead of guessing.
 *
 * The two limits need opposite advice. A burst limit clears in under a
 * minute, so the right move is to press the same button again. A daily limit
 * does not, so the right move is to do the work by hand or come back
 * tomorrow — and telling somebody to retry is how they spend an afternoon
 * pressing a button that cannot succeed.
 */
export type AiAllowanceLimit = {
  kind: "daily" | "burst";
  /** Seconds until it works, when whoever threw it kept them. */
  retryAfterSeconds?: number;
};

const CODES = {
  organization_daily_limit: "daily",
  organization_burst_limit: "burst",
} as const satisfies Record<string, AiAllowanceLimit["kind"]>;

/**
 * Recognises the allowance in the guard's own error, and in a domain error
 * that carried its code onward — which is how most services pass it up.
 */
export function readAiAllowanceLimit(error: unknown): AiAllowanceLimit | null {
  if (error instanceof OrganizationAiRateLimitError) {
    return { kind: CODES[error.code], retryAfterSeconds: error.retryAfterSeconds };
  }
  if (!error || typeof error !== "object") return null;
  const carried = (error as { code?: unknown }).code;
  if (typeof carried !== "string" || !(carried in CODES)) return null;
  const seconds = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
  return {
    kind: CODES[carried as keyof typeof CODES],
    ...(typeof seconds === "number" && seconds > 0 ? { retryAfterSeconds: seconds } : {}),
  };
}

/**
 * The sentence itself. Each surface says what it did or did not do first —
 * "Nothing was generated", "What you pasted is still in the box" — because
 * that part is only true where it is said.
 */
export function aiAllowanceSentence(limit: AiAllowanceLimit): string {
  const wait = limit.retryAfterSeconds ? waitLabel(limit.retryAfterSeconds) : null;
  if (limit.kind === "daily") {
    return wait
      ? `This workspace has used today’s AI requests. They return in ${wait}, at midnight UTC.`
      : "This workspace has used today’s AI requests. They return at midnight UTC.";
  }
  return wait
    ? `This workspace is making AI requests faster than its limit allows. The same button works again in ${wait}.`
    : "This workspace is making AI requests faster than its limit allows. The same button works again in a moment.";
}

/**
 * What each surface is called where a person meets it.
 *
 * The guard counts by slug because that is what the code passes it. A person
 * refused at four in the afternoon is owed the answer in their own words, not
 * "page-coverage: 12".
 */
const SURFACE_NAMES: Record<string, string> = {
  "page-coverage": "planning a page’s tests",
  "automation-generation": "writing automation",
  "automation-repair": "repairing a failing test",
  "requirement-review": "reviewing requirements",
  "requirement-drafting": "reading tickets into requirements",
  "criteria-coverage": "reading criteria gaps",
  "test-case-proposals": "proposing test cases",
  "failure-analysis": "explaining failures",
  "free-tools": "the free tools",
};

/**
 * "Today's requests went to planning a page's tests (12) and writing
 * automation (6)", or null when nothing is known.
 *
 * Listed largest first and cut at three, because the question behind it is
 * "what used it all", and a tail of ones answers nothing. A surface this
 * product does not have a name for is shown by its own name rather than
 * dropped: a silent omission in a tally is how a total stops adding up.
 */
export function spentOnSentence(spend: ReadonlyArray<{ surface: string; used: number }>): string | null {
  if (spend.length === 0) return null;
  const named = spend.map((entry) => `${SURFACE_NAMES[entry.surface] ?? entry.surface} (${entry.used})`);
  const shown = named.slice(0, 3);
  const rest = spend.slice(3).reduce((total, entry) => total + entry.used, 0);
  const list =
    shown.length === 1
      ? shown[0]
      : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  return rest > 0
    ? `Today’s requests went to ${list}, with ${rest} elsewhere.`
    : `Today’s requests went to ${list}.`;
}

/** The sentence for an error, or null when the failure was something else. */
export function aiAllowanceMessage(error: unknown): string | null {
  const limit = readAiAllowanceLimit(error);
  return limit ? aiAllowanceSentence(limit) : null;
}
