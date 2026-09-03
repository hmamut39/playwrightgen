import { spawn } from "node:child_process";
import pg from "pg";

function requiredEnvironmentVariable(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for a verified database migration.`);
  }
  return value;
}

const expectedBranchId = requiredEnvironmentVariable(
  "EXPECTED_NEON_BRANCH_ID",
);
const expectedProjectId = requiredEnvironmentVariable(
  "EXPECTED_NEON_PROJECT_ID",
);
const connectionString =
  process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required.");
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
let actualIdentity;
try {
  const result = await client.query(`
    SELECT name, setting
    FROM pg_settings
    WHERE name IN ('neon.branch_id', 'neon.project_id')
  `);
  actualIdentity = Object.fromEntries(
    result.rows.map(({ name, setting }) => [name, setting]),
  );
} finally {
  await client.end();
}

if (
  actualIdentity["neon.branch_id"] !== expectedBranchId ||
  actualIdentity["neon.project_id"] !== expectedProjectId
) {
  throw new Error(
    "Database target verification failed. The connected Neon project/branch does not match the approved migration target.",
  );
}

console.log(
  `Verified Neon migration target ${expectedProjectId}/${expectedBranchId}.`,
);

if (process.argv.includes("--verify-only")) {
  console.log("Verification-only mode complete; Prisma was not started.");
  process.exit(0);
}

const migration = spawn(
  process.execPath,
  [
    requiredEnvironmentVariable("npm_execpath"),
    "run",
    "prisma:migrate:deploy",
  ],
  {
    env: process.env,
    stdio: "inherit",
  },
);

const exitCode = await new Promise((resolve, reject) => {
  migration.once("error", reject);
  migration.once("exit", (code, signal) => {
    if (signal) {
      reject(new Error(`Prisma migration was terminated by ${signal}.`));
      return;
    }
    resolve(code ?? 1);
  });
});

process.exitCode = exitCode;
