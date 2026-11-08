import { createRequire } from "node:module";
import { parseArgs } from "node:util";

/**
 * Gives one workspace the Team AI allowance for a fixed number of days.
 *
 * A free workspace gets 20 AI actions a day, shared by everyone in it. One
 * "Cover a page" run can cost 18 of them -- six tests at one request to write
 * each and two to fix it -- so three people from a company trying this out
 * could spend the whole day's budget in their first ten minutes, on the
 * feature the home page leads with. They would then meet "This workspace has
 * used today's AI allowance. It resets at midnight UTC", which is true, well
 * worded, and the end of their evaluation.
 *
 * Nothing in the product needed changing for this. The entitlement already
 * carries an expiry and a per-organization ceiling, and the comment beside it
 * says why: so one customer's limit can be raised without editing a constant
 * and shipping it to everyone. What was missing was a way to use it, because
 * there is no admin surface -- and inventing one, with the authorization
 * concept it would need, is a worse thing to build the week before a demo
 * than a script the owner runs.
 *
 * It expires on its own. A trial allowance with no end date is a free Team
 * plan nobody remembers granting.
 *
 *   node scripts/grant-trial-allowance.mjs --org acme-qa --days 14
 *   node scripts/grant-trial-allowance.mjs --org acme-qa --days 14 --confirm
 *   node scripts/grant-trial-allowance.mjs --org acme-qa --revoke --confirm
 *
 * Without --confirm it says what it would do and changes nothing. DATABASE_URL
 * decides which deployment is touched, so check it before confirming.
 */

const { values } = parseArgs({
  options: {
    org: { type: "string" },
    days: { type: "string", default: "14" },
    daily: { type: "string" },
    revoke: { type: "boolean", default: false },
    confirm: { type: "boolean", default: false },
  },
});

if (!values.org) {
  console.error("Which workspace? Pass --org with the slug from its URL.");
  process.exit(1);
}

const days = Number(values.days);
if (!Number.isFinite(days) || days <= 0 || days > 365) {
  console.error("--days must be a number of days between 1 and 365.");
  process.exit(1);
}

const daily = values.daily === undefined ? null : Number(values.daily);
if (daily !== null && (!Number.isInteger(daily) || daily < 1 || daily > 10_000)) {
  console.error("--daily must be a whole number of AI actions per day.");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set, so there is no deployment to change.");
  process.exit(1);
}

// Enough to tell production from preview without printing a credential.
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

const found = await client.query(
  'select id, name from "Organization" where slug = $1',
  [values.org],
);
if (found.rowCount === 0) {
  console.error(`No workspace with the slug "${values.org}" on ${host}.`);
  await client.end();
  process.exit(1);
}
const organization = found.rows[0];

const existing = await client.query(
  `select enabled, "effectiveFrom", "effectiveUntil", "limitValue"
     from "OrganizationEntitlement" where "organizationId" = $1 and key = 'ai.workflows'`,
  [organization.id],
);
const now = new Date();
const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

console.log(`Workspace : ${organization.name} (${values.org})`);
console.log(`Database  : ${host}`);
console.log(
  `Now       : ${
    existing.rowCount === 0
      ? "free allowance, 20 AI actions a day"
      : `entitlement ${existing.rows[0].enabled ? "enabled" : "disabled"}` +
        `, limit ${existing.rows[0].limitValue ?? "the Team default"}` +
        `, until ${existing.rows[0].effectiveUntil?.toISOString().slice(0, 10) ?? "no end date"}`
  }`,
);

if (values.revoke) {
  console.log("Change    : back to the free allowance, immediately");
} else {
  console.log(
    `Change    : Team allowance${daily === null ? "" : ` of ${daily} a day`}, until ${until
      .toISOString()
      .slice(0, 10)} (${days} days)`,
  );
}

if (!values.confirm) {
  console.log("\nNothing was changed. Add --confirm to apply it.");
  await client.end();
  process.exit(0);
}

if (values.revoke) {
  await client.query(
    `update "OrganizationEntitlement" set enabled = false, "effectiveUntil" = $2, "updatedAt" = $2
       where "organizationId" = $1 and key = 'ai.workflows'`,
    [organization.id, now],
  );
  console.log("\nDone. This workspace is back on the free allowance.");
} else {
  // MANUAL_OVERRIDE, not SUBSCRIPTION: nobody paid for this, and a row that
  // claims a subscription would make the billing records lie about revenue.
  await client.query(
    `insert into "OrganizationEntitlement"
       ("id", "organizationId", key, enabled, source, "effectiveFrom", "effectiveUntil", "limitValue", "createdAt", "updatedAt")
     values (gen_random_uuid(), $1, 'ai.workflows', true, 'MANUAL_OVERRIDE', $2, $3, $4, $2, $2)
     on conflict ("organizationId", key) do update
       set enabled = true, source = 'MANUAL_OVERRIDE', "effectiveFrom" = $2,
           "effectiveUntil" = $3, "limitValue" = $4, "updatedAt" = $2`,
    [organization.id, now, until, daily],
  );
  console.log(`\nDone. It lapses on ${until.toISOString().slice(0, 10)} without anybody remembering to.`);
}

await client.end();
