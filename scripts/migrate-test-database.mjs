import { spawn } from "node:child_process";

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

function requiredEnvironmentVariable(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for a verified test migration.`);
  }
  return value;
}

const connectionString = requiredEnvironmentVariable("TEST_DATABASE_URL");
const expectedHost = requiredEnvironmentVariable("EXPECTED_TEST_DATABASE_HOST");
const expectedDatabase = requiredEnvironmentVariable(
  "EXPECTED_TEST_DATABASE_NAME",
);
const parsed = new URL(connectionString);
const actualHost = parsed.hostname;
const actualDatabase = decodeURIComponent(parsed.pathname.slice(1));
const targetIdentity = `${actualHost} ${actualDatabase}`;
const testMarker = /(^|[-_.])(test|testing)([-_.]|$)/i;
const productionMarker = /(^|[-_.])(prod|production|live)([-_.]|$)/i;

if (!/^postgres(?:ql)?:$/i.test(parsed.protocol)) {
  throw new Error("TEST_DATABASE_URL must be a PostgreSQL connection URL.");
}

if (productionMarker.test(targetIdentity) || !testMarker.test(targetIdentity)) {
  throw new Error(
    "Refusing to migrate a target that is not explicitly identified as a test database.",
  );
}

if (actualHost !== expectedHost || actualDatabase !== expectedDatabase) {
  throw new Error(
    "Test database target verification failed. Host or database name differs from the explicit expected target.",
  );
}

console.log(`Verified test migration target ${actualHost}/${actualDatabase}.`);

if (process.argv.includes("--verify-only")) {
  console.log("Verification-only mode complete; Prisma was not started.");
  process.exit(0);
}

const npmCli = requiredEnvironmentVariable("npm_execpath");
const migration = spawn(
  process.execPath,
  [npmCli, "run", "prisma:migrate:deploy"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
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
