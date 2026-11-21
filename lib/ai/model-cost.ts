/**
 * What the model work behind a test actually cost.
 *
 * Every AI run in this product already stores its token counts -- `AiRun`,
 * `AutomationArtifactVersion` and `FailureAnalysis` each keep input, output
 * and total -- and nothing has ever turned them into money. Two places
 * printed "12430 tokens" beside a generated test, which is a number nobody
 * can act on: it answers neither "can we afford to run this on every test we
 * own" nor "is this cheaper than writing the test by hand", the two questions
 * anybody evaluating this product actually has.
 *
 * The figure that matters is cost per *proven* test, and the honest version of
 * it divides everything spent by the tests that came out the other end. A
 * generated version that failed on the live page still cost money. Counting
 * only the successes would quote a price nobody can buy at, which is the
 * oldest trick in this particular book, so the total here is over every
 * attempt and the divisor is the proven ones.
 *
 * Three things this cannot know, and says so rather than guessing:
 *
 * - Whether part of a prompt was served from the provider's cache. Cached
 *   input is a tenth of the price on gpt-5-mini and the counts kept here do
 *   not separate it, so every figure is an upper bound.
 * - What a model costs today. These are rates copied by hand on the date
 *   below, and a price table in a repository is stale the moment the provider
 *   changes one. The date travels with the figure for exactly that reason.
 * - What an unknown model costs. A model missing from the table prices as
 *   nothing at all rather than as something plausible, and the caller is told
 *   how many fell out so the total is never read as complete.
 */

/** USD per million tokens. */
type ModelPrice = { input: number; output: number; cachedInput: number | null };

/** Where these came from, so the next person can check them in one click. */
export const PRICES_SOURCE = "https://developers.openai.com/api/docs/pricing";

/**
 * When they were read off that page.
 *
 * Shown to the reader with the money, not kept in a comment. A price copied
 * into a repository is a claim about the outside world, and a claim about the
 * outside world with no date on it is the kind that stays wrong for a year.
 */
export const PRICES_COPIED_ON = "2026-11-21";

/** Standard tier, read from the page above on the date above. */
const PRICES: Record<string, ModelPrice> = {
  "gpt-5-mini": { input: 0.25, output: 2, cachedInput: 0.025 },
  "gpt-5": { input: 1.25, output: 10, cachedInput: 0.125 },
  "gpt-4o": { input: 2.5, output: 10, cachedInput: 1.25 },
  "gpt-4o-mini": { input: 0.15, output: 0.6, cachedInput: 0.075 },
};

/**
 * The known models, longest name first.
 *
 * A stored model is whatever the environment variable said, and providers pin
 * dated releases: `gpt-5-mini-2026-08-07` is a gpt-5-mini and must price like
 * one. Longest first because "gpt-5" is a prefix of "gpt-5-mini", and a
 * shortest-match rule would quietly bill the cheap model at five times its
 * rate.
 */
const KNOWN = Object.keys(PRICES).sort((a, b) => b.length - a.length);

export function modelPrice(model: string): ModelPrice | null {
  const name = model.trim().toLowerCase();
  if (!name) return null;
  if (PRICES[name]) return PRICES[name];
  const match = KNOWN.find((known) => name.startsWith(known));
  return match ? PRICES[match] : null;
}

export type TokenUse = {
  model: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
};

/**
 * What one run cost, or null when that cannot be said.
 *
 * Both counts are required. They are written together from one usage report,
 * so a row holding one and not the other is a row from a path that did not
 * record usage; pricing a total by assuming a split would be inventing the
 * expensive half.
 */
export function usdForUse(use: TokenUse): number | null {
  const price = modelPrice(use.model);
  if (!price) return null;
  const { inputTokens, outputTokens } = use;
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") return null;
  if (inputTokens < 0 || outputTokens < 0) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

export type ProvenCost = {
  /** Every version generated, proven or not. Failed attempts cost money too. */
  attempts: number;
  /** Versions that passed on the real page. */
  proven: number;
  /** Attempts the table could price. */
  priced: number;
  /** Attempts it could not: no token count, or a model it does not know. */
  unpriced: number;
  /** Upper bound on the priced attempts, or null when none could be priced. */
  usd: number | null;
  /** That total over the proven count, or null when nothing is proven yet. */
  perProvenUsd: number | null;
};

export function costOfProving(
  versions: Array<TokenUse & { proven: boolean }>,
): ProvenCost {
  let usd = 0;
  let priced = 0;
  let unpriced = 0;
  let proven = 0;
  for (const version of versions) {
    if (version.proven) proven += 1;
    const cost = usdForUse(version);
    if (cost === null) {
      unpriced += 1;
      continue;
    }
    priced += 1;
    usd += cost;
  }
  return {
    attempts: versions.length,
    proven,
    priced,
    unpriced,
    usd: priced > 0 ? usd : null,
    // Not a division by zero and not the total wearing a per-test label: a
    // project with nothing proven has no cost per proven test, and saying
    // "$0.04 per proven test" of a project with no proven test would be the
    // figure most worth not printing.
    perProvenUsd: priced > 0 && proven > 0 ? usd / proven : null,
  };
}

/**
 * Money, at a precision that does not round the answer away.
 *
 * A generated test costs fractions of a cent, and two decimal places turn
 * every one of them into "$0.00" -- a number that reads as free and makes the
 * whole figure pointless. Four decimals below a cent, two above.
 */
export function usdLabel(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  // Three decimals, less a trailing zero, so 42 cents reads "$0.42" and not
  // "$0.420" -- which looks like a unit the reader has to work out.
  if (usd < 1) return `$${usd.toFixed(3).replace(/0$/, "")}`;
  return `$${usd.toFixed(2)}`;
}

/** 21 November 2026, for a sentence rather than a log line. */
function readableDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * What to tell the reader, or null when there is nothing honest to say.
 *
 * One clause per fact, and every limit of the figure stated beside it rather
 * than left for somebody to discover: the attempts it covers, the rate it
 * used and when that rate was copied, that a cache would make it cheaper, and
 * how many attempts are missing from it entirely.
 */
export function provenCostNote(cost: ProvenCost): string | null {
  if (cost.attempts === 0) return null;

  const attempts = `${cost.attempts} version${cost.attempts === 1 ? "" : "s"}`;
  const rates = `at OpenAI's published rates as of ${readableDate(PRICES_COPIED_ON)}`;
  const cache =
    "The figure assumes none of the prompt was served from the provider's cache, which would make it cheaper.";
  const missing =
    cost.unpriced > 0
      ? ` ${cost.unpriced} of them kept no token count and ${cost.unpriced === 1 ? "is" : "are"} not in this figure.`
      : "";

  if (cost.usd === null) {
    // Not "generated": imported code is a version here too, and it was never
    // generated by anything. Checked against the dev database, where three of
    // six artifacts are imported drafts carrying no counts at all.
    return `${attempts} here, none of which kept a token count, so what this test cost cannot be said.`;
  }

  if (cost.perProvenUsd === null) {
    return (
      `${attempts} generated and none proven on your live page yet, so there is no cost per proven test. ` +
      `The attempts come to ${usdLabel(cost.usd)} ${rates}. ${cache}${missing}`
    );
  }

  const proven = `${cost.proven} proven on your live page`;
  const per =
    cost.proven === 1
      ? `${usdLabel(cost.usd)} of model usage in all`
      : `${usdLabel(cost.usd)} in all, about ${usdLabel(cost.perProvenUsd)} per proven test`;
  return `${attempts}, ${proven}: ${per}, ${rates}. ${cache}${missing}`;
}
