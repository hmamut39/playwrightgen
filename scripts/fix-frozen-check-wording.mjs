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
 * Without --confirm it prints each sentence as it is and as it would read,
 * both computed by the database, and changes nothing. A count of matching rows
 * is not a check: the first version of this script captured the whole word
 * instead of its plural and wrote "19 stepchecks" into 36 rows, and a query
 * counting rows that still matched "[0-9]+ checks?" reported every one of them
 * fixed. Read the sentences.
 *
 * DATABASE_URL decides which deployment is touched. Running it twice is safe.
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

/**
 * The corrected text, as one SQL expression over a column.
 *
 * Two replacements, both capturing only the plural so the noun is replaced
 * rather than prefixed. The first repairs "N stepchecks", which an earlier
 * version of this script wrote; without it a second run would leave that text
 * untouched, because it no longer says "checks".
 */
const corrected = (column) =>
  `regexp_replace(
     regexp_replace(${column}, '([0-9]+) stepcheck(s?)', E'\\\\1 step\\\\2', 'g'),
     '([0-9]+) check(s?)', E'\\\\1 step\\\\2', 'g')`;

// Matches both what the product wrote and what the broken script wrote.
// Non-capturing: `substring(... from ...)` returns the first capture group
// when there is one, so a capturing group here printed "8" as the whole
// sentence and made the preview useless for reading.
const NEEDS_WORK = `[0-9]+ (?:check|stepcheck)s?`;

const targets = [
  {
    what: "version summaries",
    // Only rows whose own run has no assertion count: a row that has one is
    // already describing checks correctly and must not be reworded.
    where: `summary ~ '${NEEDS_WORK}' and ("liveRun" is null or "liveRun"->>'checks' is null)`,
    table: `"AutomationArtifactVersion"`,
    column: "summary",
  },
  {
    what: "page-coverage items",
    where: `detail ~ '${NEEDS_WORK}'`,
    table: `"PageCoverageItem"`,
    column: "detail",
  },
];

let total = 0;
for (const target of targets) {
  const { column, table, where } = target;
  const { rows } = await client.query(
    `select id,
            substring(${column} from '[^.]*${NEEDS_WORK}[^.]*') as before,
            substring(${corrected(column)} from '[^.]*[0-9]+ steps?[^.]*') as after
       from ${table} where ${where}`,
  );
  console.log(`${target.what}: ${rows.length}`);
  for (const row of rows.slice(0, 4)) {
    console.log(`  from: ${(row.before ?? "").trim().slice(0, 100)}`);
    console.log(`  to:   ${(row.after ?? "").trim().slice(0, 100)}`);
  }
  if (rows.length > 4) console.log(`  and ${rows.length - 4} more`);
  if (values.confirm && rows.length > 0) {
    await client.query(`update ${table} set ${column} = ${corrected(column)} where ${where}`);
  }
  total += rows.length;
  console.log("");
}

if (values.confirm) {
  // Read back what is there now, rather than trusting the update's own count.
  let left = 0;
  for (const { table, column } of targets) {
    const check = await client.query(
      `select count(*)::int as n from ${table} where ${column} ~ '${NEEDS_WORK}'`,
    );
    left += check.rows[0].n;
  }
  console.log(
    left === 0
      ? `Done. ${total} record${total === 1 ? "" : "s"} now say what they counted, and nothing says "checks" where it counted steps.`
      : `${total} updated, but ${left} row${left === 1 ? "" : "s"} still read wrong. Look at them before running this again.`,
  );
  if (left > 0) process.exitCode = 1;
} else {
  console.log(`Nothing was changed. Add --confirm to correct ${total} record${total === 1 ? "" : "s"}.`);
}

await client.end();
