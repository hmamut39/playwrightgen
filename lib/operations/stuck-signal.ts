import "server-only";

import { Redis } from "@upstash/redis";

import { validateRedisEnvironment } from "@/lib/env";
import { sendAlertEmail } from "@/lib/services/alert-email";

/**
 * Telling the owner, the same day, that somebody wanted this to work and it
 * did not.
 *
 * Feedback reaches him when a person writes it, and most people do not write
 * it -- they close the tab. In a one-week trial that silence is the whole
 * result: a stranger meets the daily allowance on their third generation, or
 * the browser service is out of credit, and the owner finds out after the
 * week is over, from nothing.
 *
 * Deliberately narrow. These are the moments that *end* an evaluation, not
 * every error: a burst limit clears in a minute and a failed test is the
 * product working. Three things qualify -- the workspace's day is spent, the
 * model provider is out of credit, or no browser can be opened -- and each is
 * a thing the owner can act on within the hour.
 *
 * Three rules keep it from becoming noise or a leak.
 *
 * One mail per kind per hour, held in Redis, because the fourth person to hit
 * the same wall tells him nothing the first did not, and an inbox that fills
 * up is an inbox that gets filtered.
 *
 * Nothing a person wrote ever travels: no code, no page text, no requirement,
 * no email address. The workspace id does, because it is what he needs to
 * grant an allowance, and it is an internal identifier rather than anything
 * about a person.
 *
 * It never throws and never blocks. A request that is already refusing
 * somebody must not also fail because a mail server was slow.
 */

export type StuckMoment =
  | "daily_allowance_exhausted"
  | "provider_out_of_credit"
  | "browser_unavailable";

/** What each moment means, and what the owner can do about it today. */
const MOMENTS: Record<StuckMoment, { subject: string; what: string; do: string }> = {
  daily_allowance_exhausted: {
    subject: "A workspace has used up its day",
    what: "A workspace spent its daily AI allowance and was refused. Whoever was using it has stopped where they were.",
    do: "If they are meant to be evaluating, grant them a trial allowance: node scripts/grant-trial-allowance.mjs --org <slug> --days 14 --confirm",
  },
  provider_out_of_credit: {
    subject: "The AI account is out of credit",
    what: "A request was refused by the model provider for want of credit. Every AI surface is down for everyone until it is topped up.",
    do: "Top up the provider account. On 2026-10-19 this state lasted long enough for the home page to answer 500 for every visitor.",
  },
  browser_unavailable: {
    subject: "No browser could be opened",
    what: "A live run could not get a browser. Running a test on a real page is the product's headline promise, and it is not working.",
    do: "Check the Browserless plan and BROWSERLESS_API_KEY.",
  },
};

const ONE_HOUR = 60 * 60;

type Dependencies = {
  /** Returns true when this is the first of its kind within the window. */
  claim?: (key: string, seconds: number) => Promise<boolean>;
  send?: typeof sendAlertEmail;
  source?: Readonly<Record<string, string | undefined>>;
};

/**
 * The address to tell. The same one feedback already uses, so turning this on
 * took no new configuration -- it was already proved working on 2026-11-08.
 */
function owner(source: Readonly<Record<string, string | undefined>>) {
  return (
    source.OWNER_ALERT_EMAIL?.trim() ||
    source.FEEDBACK_NOTIFY_EMAIL?.trim() ||
    source.WAITLIST_NOTIFY_EMAIL?.trim() ||
    null
  );
}

async function claimOnce(key: string, seconds: number, source: Readonly<Record<string, string | undefined>>) {
  const config = validateRedisEnvironment(source);
  const redis = new Redis({ url: config.UPSTASH_REDIS_REST_URL, token: config.UPSTASH_REDIS_REST_TOKEN });
  // NX: whoever sets it first sends the mail; everybody else that hour does
  // not. The same primitive the public rate limits use.
  const set = await redis.set(key, "1", { ex: seconds, nx: true });
  return set === "OK";
}

export async function somebodyGotStuck(
  input: { what: StuckMoment; where: string; organizationId?: string | null },
  dependencies: Dependencies = {},
): Promise<"sent" | "held" | "not_configured" | "failed"> {
  const source = dependencies.source ?? process.env;
  try {
    const to = owner(source);
    if (!to) return "not_configured";

    const claim = dependencies.claim ?? ((key, seconds) => claimOnce(key, seconds, source));
    const first = await claim(`playwrightgen:stuck:${input.what}`, ONE_HOUR);
    if (!first) return "held";

    const moment = MOMENTS[input.what];
    const send = dependencies.send ?? sendAlertEmail;
    const sent = await send({
      to,
      subject: `PlaywrightGen: ${moment.subject}`,
      text: [
        moment.what,
        "",
        `Where: ${input.where}`,
        input.organizationId ? `Workspace: ${input.organizationId}` : "Workspace: not signed in",
        "",
        moment.do,
        "",
        "One of these per hour at most. Nothing anybody wrote is included.",
      ].join("\n"),
    });
    return sent ? "sent" : "failed";
  } catch {
    // Never the reason a request fails. The person is already being refused;
    // telling the owner about it is strictly extra.
    return "failed";
  }
}
