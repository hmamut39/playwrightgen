import { createRequire } from "node:module";
import { parseArgs } from "node:util";

/**
 * Corrects records that call an operation count a check count.
 *
 * The preview runner counted every operation it performed -- a goto, a fill, a
 * press and an assertion were each one "passed" -- and the product showed that
 * number as "checks". A generated test with three assertions and four actions
 * said "7 checks passed" under "proven on your real page". The code now counts
 * assertions separately, so new runs say what they proved.
 *
 * Some of those claims are not computed when a page loads: they were written
 * into prose and stored, on a version's summary and on a page-coverage item's
 * detail. Those sentences are still shown to a reviewer as current fact, so
 * leaving them is leaving the overstatement in front of people.
 *
 * The number stays; only the word changes. "7 checks" becomes "7 steps",
 * which is what the stored number counted. Rows whose run did record its
 * assertions are left alone -- their wording is already right.
 *
 *   node scripts/fix-frozen-check-wording.mjs
 *   node scripts/fix-frozen-check-wording.mjs --confirm
 *
 * Without --confirm it prints every sentence it would change and changes
 * nothing. DATABASE_URL decides which deployment is touched.
 */

const { values } = parseArgs({ options: { confirm: { type: "boolean", default: false } } });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set, so there is no deployment to change.");
  process.exit(1);
}

const host = (() => {
  try {
    return new URL(url).host;
  } catch {
    return "an unreadable DATABASE_URL";
  }
})();

const require = createRequire("C:/Users/Afiyat/playwrightgen/package.json");
const { Client } = require("pg");
const client = new Client({ connectionString: url });
await client.connect();

console.log(`Database : ${host}`);
console.log(`Change   : "N checks" -> "N steps" where the run never counted its assertions\n`);

// Only rows whose own run has no assertion count: a row that has one is
// already describing checks correctly and must not be reworded.
const CHECKS = String.raw`([0-9]+) (checks?)`;

const targets = [
  {
    what: "version summaries",
    select: `select id, summary as text from "AutomationArtifactVersion"
              where summary ~ '${CHECKS}' and ("liveRun" is null or "liveRun"->>'checks' is null)`,
    update: `update "AutomationArtifactVersion"
                set summary = regexp_replace(summary, '${CHECKS}', E'\\\\1 step\\\\2', 'g')
              where id = $1`,
  },
  {
    what: "page-coverage items",
    select: `select id, detail as text from "PageCoverageItem" where detail ~ '${CHECKS}'`,
    update: `update "PageCoverageItem"
                set detail = regexp_replace(detail, '${CHECKS}', E'\\\\1 step\\\\2', 'g')
              where id = $1`,
  },
];

let total = 0;
for (const target of targets) {
  const { rows } = await client.query(target.select);
  console.log(`${target.what}: ${rows.length}`);
  for (const row of rows.slice(0, 4)) {
    const phrase = /[^.]*[0-9]+ checks?[^.]*/.exec(row.text ?? "")?.[0]?.trim();
    if (phrase) console.log(`  · ${phrase.slice(0, 120)}`);
  }
  if (rows.length > 4) console.log(`  · and ${rows.length - 4} more`);
  if (values.confirm) {
    for (const row of rows) await client.query(target.update, [row.id]);
  }
  total += rows.length;
  console.log("");
}

// "check" singular becomes "step", "checks" becomes "steps": the capture group
// carries the plural, so one expression covers both.
console.log(
  values.confirm
    ? `Done. ${total} record${total === 1 ? "" : "s"} now say what they counted.`
    : `Nothing was changed. Add --confirm to correct ${total} record${total === 1 ? "" : "s"}.`,
);

await client.end();
