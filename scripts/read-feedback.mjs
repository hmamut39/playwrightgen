import { Redis } from "@upstash/redis";
import { config } from "dotenv";

/**
 * Every report somebody has sent through "Something wrong on this page?".
 *
 *     npm run feedback           the last 20
 *     npm run feedback -- 100    the last 100
 *
 * The route has stored these since it was written -- a sorted set, newest
 * last, kept for 180 days -- and **nothing has ever read them**. The mail was
 * the only way they reached anybody, so a failure to send was a report nobody
 * would ever see.
 *
 * Which is not hypothetical. On 2026-11-21 a test report sent through the
 * live site logged:
 *
 *     "code":"notice_not_sent","reason":"The playwrightgen.com domain is not
 *      verified. Please, add and verify your domain on resend.com/domains"
 *     "code":"feedback_received","status":"succeeded"
 *
 * The visitor was thanked and told it had gone straight to the person who
 * builds this. It had gone to Redis, where it still is, and where this
 * command now finds it.
 *
 * Reads only. It never deletes: the route's own retention does that, and a
 * reader that could empty the inbox is one mistake away from losing the thing
 * it exists to show.
 */
config({ path: ".env.local", quiet: true });

const FEEDBACK_KEY = "playwrightgen:feedback:v1";

/**
 * The same line lib/services/feedback-report.ts writes, inlined because this
 * script runs without the TypeScript loader the rest of the product uses.
 * The logic is tested there; this is the two-line copy that prints it.
 */
const heading = (report) => {
  const delivery =
    report.notified === undefined ? "delivery unrecorded" : report.notified ? "emailed" : "NEVER EMAILED";
  return `${report.at ?? "(no date)"}  ·  ${report.path ?? "(no page)"}  ·  ${report.who ?? "(unknown)"}  ·  ${delivery}`;
};

const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
if (!url || !token) {
  console.error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are needed; both live in .env.local.");
  process.exit(1);
}

const wanted = Number(process.argv[2] ?? 20);
if (!Number.isFinite(wanted) || wanted <= 0) {
  console.error("Usage: npm run feedback -- <how many>");
  process.exit(1);
}

const redis = new Redis({ url, token });
const total = await redis.zcard(FEEDBACK_KEY);
// Newest last in the set, so take from the end and turn it round.
const rows = await redis.zrange(FEEDBACK_KEY, -wanted, -1);
const reports = rows
  .map((row) => {
    try {
      return typeof row === "string" ? JSON.parse(row) : row;
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .reverse();

console.log("");
if (reports.length === 0) {
  console.log(`No reports stored. (${total} in the set.)`);
  console.log("That is either nobody writing, or nobody finding the link. Both are worth knowing.");
  process.exit(0);
}

console.log(`${reports.length} of ${total} report${total === 1 ? "" : "s"}, newest first.`);
for (const report of reports) {
  console.log("");
  console.log(`  ${heading(report)}`);
  for (const line of String(report.message ?? "").split("\n")) console.log(`    ${line}`);
}
const unsent = reports.filter((report) => report.notified === false).length;
if (unsent > 0) {
  console.log("");
  console.log(
    `${unsent} of these were never emailed to anybody. Nothing retries them: the mail was attempted once, at the time, and failed.`,
  );
}
console.log("");
