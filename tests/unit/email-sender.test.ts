import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { emailSender } from "@/lib/services/alert-email";

/**
 * Who every message this product sends comes from.
 *
 * Until a sending domain is verified, mail goes from Resend's shared sandbox
 * address, which delivers only to the account owner. One environment variable
 * is meant to move all of it to the verified domain the day that is done.
 *
 * It did not. LIVE_CHECKS_EMAIL_FROM was read in one place, while the
 * feedback and waitlist routes each wrote the sandbox address into their own
 * call. Setting the variable would have moved the alerts and left those two
 * behind -- and whoever set it would have had every reason to believe all
 * three had moved, because nothing would have said otherwise. The failure
 * mode is silence: a feedback notification that never arrives looks exactly
 * like nobody sending feedback.
 *
 * Found on 2026-11-21 while writing the instructions for making that DNS
 * change, by checking that the instruction would do what it claimed.
 */
const original = process.env.LIVE_CHECKS_EMAIL_FROM;

afterEach(() => {
  if (original === undefined) delete process.env.LIVE_CHECKS_EMAIL_FROM;
  else process.env.LIVE_CHECKS_EMAIL_FROM = original;
});

/** Every TypeScript file under the directories that can send mail. */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(root, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe("the address this product sends mail from", () => {
  it("falls back to the sandbox address when no domain is configured", () => {
    delete process.env.LIVE_CHECKS_EMAIL_FROM;

    expect(emailSender()).toBe("PlaywrightGen <onboarding@resend.dev>");
  });

  it("uses the configured sender once a domain is verified", () => {
    process.env.LIVE_CHECKS_EMAIL_FROM = "PlaywrightGen <alerts@playwrightgen.com>";

    expect(emailSender()).toBe("PlaywrightGen <alerts@playwrightgen.com>");
  });

  it("ignores a blank setting rather than sending from nothing", () => {
    process.env.LIVE_CHECKS_EMAIL_FROM = "   ";

    expect(emailSender()).toBe("PlaywrightGen <onboarding@resend.dev>");
  });

  it("is the only place the sandbox address is written down", () => {
    /*
     * The guard for the actual fault. A second copy of that address anywhere
     * is a message the setting cannot move, and it will be found the way this
     * one was: by somebody noticing that mail they expected never arrived.
     */
    const offenders = [...sourceFiles("lib"), ...sourceFiles("app")]
      .filter((path) => readFileSync(path, "utf8").includes("onboarding@resend.dev"))
      .map((path) => path.replace(/\\/g, "/"));

    expect(offenders, "the sandbox sender is hardcoded outside alert-email.ts").toEqual([
      "lib/services/alert-email.ts",
    ]);
  });
});
