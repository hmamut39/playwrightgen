import { spawn } from "node:child_process";

import { config } from "dotenv";

/**
 * Applies pending migrations to the Preview database.
 *
 * The Preview connection string cannot be read back from Vercel, because both
 * DATABASE_URL and DIRECT_URL are stored as Sensitive there. It therefore has to
 * live somewhere local, and `.env.local` is the right place: it is gitignored and
 * already holds the development database URL and every other server secret.
 *
 * Keeping it there is deliberate. Deleting the value after each migration turns
 * a one-time setup into recurring manual work for no meaningful security gain,
 * since equivalent secrets already sit in the same file.
 *
 * The verified migration script still runs underneath, so the fail-closed check
 * that the connected Neon project and branch match the approved target happens
 * before Prisma is started.
 */

config({ path: ".env.local", quiet: true });

const required = [
  "PREVIEW_DATABASE_URL",
  "EXPECTED_NEON_PROJECT_ID",
  "EXPECTED_NEON_BRANCH_ID",
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  console.error(
    [
      `Missing ${missing.join(", ")} in .env.local.`,
      "",
      "Add these once and Preview migrations will never ask again:",
      "",
      "  PREVIEW_DATABASE_URL=<connection string from the Neon preview branch>",
      "  EXPECTED_NEON_PROJECT_ID=<Neon project id>",
      "  EXPECTED_NEON_BRANCH_ID=<Neon branch id>",
      "",
      "Either the pooled or the direct string works; the other is derived.",
    ].join("\n"),
  );
  process.exit(1);
}

const supplied = process.env.PREVIEW_DATABASE_URL.trim();

// Accept whichever form Neon's dialog happened to be showing. Requiring the
// user to notice a pooling toggle is a needless way to fail, and the two hosts
// differ only by the `-pooler` segment.
//
// Prisma runs migrations over DIRECT_URL, and DDL plus advisory locks are
// unreliable through a connection pooler, so the direct host is what matters.
const direct =
  process.env.PREVIEW_DIRECT_URL?.trim() || supplied.replace("-pooler.", ".");

if (!/^postgres(ql)?:\/\//.test(direct)) {
  console.error(
    "PREVIEW_DATABASE_URL does not look like a PostgreSQL connection string.",
  );
  process.exit(1);
}

const child = spawn(
  process.env.npm_execpath?.endsWith(".js") ? process.execPath : "npm",
  process.env.npm_execpath?.endsWith(".js")
    ? [process.env.npm_execpath, "run", "db:migrate:verified"]
    : ["run", "db:migrate:verified"],
  {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      DATABASE_URL: supplied,
      DIRECT_URL: direct,
    },
  },
);

child.on("exit", (code) => process.exit(code ?? 1));
