import { spawn } from "node:child_process";

import { config } from "dotenv";

/**
 * Applies pending migrations to the production database.
 *
 * The production connection string cannot be read back from Vercel: both
 * DATABASE_URL and DIRECT_URL are stored there as Sensitive. It therefore has
 * to live somewhere local, and `.env.local` is the right place for the same
 * reasons the Preview string lives there -- it is gitignored and already holds
 * every other server secret.
 *
 * This exists because the alternative was a hand-assembled command. The
 * roadmap carried one, and it was wrong: `migrate-verified.mjs` reads
 * `DIRECT_URL` from the environment and deliberately does not load
 * `.env.local`, so the command either failed outright or, with `.env.local`
 * exported by some other means, pointed at the development branch. A
 * production migration is the wrong place to be assembling a command from
 * memory.
 *
 * The approved target is written down here rather than passed in, so this
 * script can only ever migrate production. The fail-closed check in
 * `migrate-verified.mjs` still runs underneath: it asks the connected
 * database which Neon project and branch it is, and refuses if the answer is
 * not this one. Pointing PRODUCTION_DATABASE_URL at the wrong database
 * therefore stops before Prisma starts.
 *
 * Pass `--verify-only` to confirm the target without migrating.
 */

config({ path: ".env.local", quiet: true });

/** The only database this script will ever migrate. */
const EXPECTED_NEON_PROJECT_ID = "restless-frost-04247280";
const EXPECTED_NEON_BRANCH_ID = "br-flat-boat-axjnmd13";

const supplied = process.env.PRODUCTION_DATABASE_URL?.trim();
if (!supplied) {
  console.error(
    [
      "Missing PRODUCTION_DATABASE_URL in .env.local.",
      "",
      "Add it once and production migrations will never ask again:",
      "",
      "  PRODUCTION_DATABASE_URL=<connection string from the Neon production branch>",
      "",
      `The branch is ${EXPECTED_NEON_BRANCH_ID} in project ${EXPECTED_NEON_PROJECT_ID}.`,
      "Either the pooled or the direct string works; the other is derived.",
      "",
      "Vercel cannot show it: DATABASE_URL and DIRECT_URL are Sensitive there.",
      "Copy it from the Neon dashboard instead.",
    ].join("\n"),
  );
  process.exit(1);
}

// Accept whichever form Neon's dialog happened to be showing. Prisma runs
// migrations over DIRECT_URL, and DDL plus advisory locks are unreliable
// through a connection pooler, so the direct host is what matters.
const direct =
  process.env.PRODUCTION_DIRECT_URL?.trim() || supplied.replace("-pooler.", ".");

if (!/^postgres(ql)?:\/\//.test(direct)) {
  console.error(
    "PRODUCTION_DATABASE_URL does not look like a PostgreSQL connection string.",
  );
  process.exit(1);
}

const usesNpmJs = process.env.npm_execpath?.endsWith(".js");
const child = spawn(
  usesNpmJs ? process.execPath : "npm",
  usesNpmJs
    ? [process.env.npm_execpath, "run", "db:migrate:verified", "--", ...process.argv.slice(2)]
    : ["run", "db:migrate:verified", "--", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      // The verified script reads these from the environment and does not load
      // .env.local, which is what keeps a development string from reaching a
      // production migration by accident.
      DIRECT_URL: direct,
      DATABASE_URL: direct,
      EXPECTED_NEON_PROJECT_ID,
      EXPECTED_NEON_BRANCH_ID,
    },
  },
);

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (signal) {
      reject(new Error(`The production migration was terminated by ${signal}.`));
      return;
    }
    resolve(code ?? 1);
  });
});

process.exitCode = exitCode;
