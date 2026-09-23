import "server-only";

import { Resend } from "resend";

/**
 * Telling a team by email that a daily check started failing.
 *
 * Alerts go to a Slack or Discord channel today, and a team with neither
 * learns about a failure the next time somebody opens the app -- which, for
 * the one feature whose whole point is to say "it broke on Tuesday", is too
 * late. Email is what everybody already has.
 *
 * Two rules keep this from becoming a way to mail strangers. The address must
 * belong to a member of the workspace, which is checked before it is stored,
 * and sending never throws: a round of checks that produced real evidence must
 * not be lost because a mail server was slow.
 */

export type AlertEmail = { to: string; subject: string; text: string };

export type EmailSender = (message: AlertEmail) => Promise<boolean>;

/**
 * Who the mail comes from. Until a sending domain is verified this is
 * Resend's shared address, which only delivers to the account owner; the
 * feature is built and tested against that, and changing one environment
 * variable turns it on for everyone.
 */
function sender() {
  return process.env.LIVE_CHECKS_EMAIL_FROM?.trim() || "PlaywrightGen <onboarding@resend.dev>";
}

/** A plain-looking address. Deliberately not clever: delivery decides the rest. */
export function looksLikeEmail(value: string) {
  const trimmed = value.trim();
  return trimmed.length <= 320 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(trimmed);
}

export function alertSubject(projectName: string, failing: number, recovered: number) {
  if (failing > 0) {
    return `${projectName}: ${failing} test${failing === 1 ? "" : "s"} started failing today`;
  }
  if (recovered > 0) {
    return `${projectName}: ${recovered} test${recovered === 1 ? "" : "s"} passing again`;
  }
  return `${projectName}: daily check`;
}

/**
 * Sends one alert. Returns whether it went, and never throws: the caller is
 * in the middle of recording evidence.
 */
export const sendAlertEmail: EmailSender = async (message) => {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  // Without a key the product still works; it simply cannot say anything by mail.
  if (!apiKey) return false;
  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: sender(),
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    if (result.error) {
      // The address and the reason, never the body: a failing test's output
      // can quote a page, and logs are read by more people than the mail is.
      console.error("[live-checks] alert email refused", result.error.message);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[live-checks] alert email could not be sent", error instanceof Error ? error.message : error);
    return false;
  }
};
