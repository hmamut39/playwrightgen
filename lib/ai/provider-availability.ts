import "server-only";

/**
 * Telling an exhausted account apart from a busy one.
 *
 * Both arrive as HTTP 429 and they mean opposite things. A rate limit is "too
 * many just now" and waiting fixes it. "You have no credits remaining" is
 * "this will not work until somebody pays", and no amount of waiting or
 * retrying changes it.
 *
 * Found on 2026-10-19: production's Quick Generate -- the button on the home
 * page -- had been answering 500 "Quick Generate failed. Please try again."
 * The provider was saying `429 You have no credits remaining. Add credits to
 * continue using the API.` Nothing logged that sentence and nothing showed
 * it, so the one page a stranger tries first was broken, the message invited
 * them to try again, and the only person who could fix it had no way to know.
 *
 * Three surfaces repeated the same mistake: both free tools and the
 * workspace's "Cover a page", whose driver retried the call in a loop.
 */

/** OpenAI's own code for an account that has run out, as it appears on the error. */
const EXHAUSTED_CODES = new Set(["insufficient_quota", "billing_hard_limit_reached"]);

function errorCodeOf(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { code?: unknown; error?: { code?: unknown; type?: unknown } };
  const code = candidate.code ?? candidate.error?.code ?? candidate.error?.type;
  return typeof code === "string" ? code : null;
}

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/**
 * True when the AI provider has refused because the account has nothing left
 * to spend, rather than because it is momentarily busy.
 *
 * Deliberately narrow. A plain rate limit is also a 429 and must keep its
 * existing behaviour -- waiting it out is the right answer there, and
 * mistaking one for the other would turn a recoverable pause into a page that
 * tells people the product is unavailable.
 */
export function isProviderOutOfCredit(error: unknown): boolean {
  const code = errorCodeOf(error);
  if (code && EXHAUSTED_CODES.has(code)) return true;
  if (statusOf(error) !== 429) return false;
  const message = error instanceof Error ? error.message : String(error ?? "");
  // The wording that means "pay", as distinct from "slow down".
  return /no credits remaining|insufficient[_ ]quota|exceeded your current quota|billing/i.test(message);
}

/**
 * A short reason for the server log, safe to write down.
 *
 * The provider's message is useful and contains no secret; the request that
 * produced it does, so only the message is taken, trimmed, and stripped of
 * anything resembling a key if the provider ever echoes one back.
 */
export function providerFailureReason(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "unknown");
  return raw
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}
