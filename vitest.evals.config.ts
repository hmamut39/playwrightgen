import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

/**
 * Evals are separated from the test suite on purpose.
 *
 * They call a real provider, so they cost money and their results vary between
 * runs. Mixing them into `npm test` would make an ordinary test run non-
 * deterministic and chargeable, and would tempt someone to relax an assertion to
 * get a green build. They are run deliberately, by `npm run evals`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": repositoryRoot,
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    fileParallelism: false,
    setupFiles: ["./evals/setup.ts"],
    include: ["evals/**/*.eval.ts"],
    // A provider round trip is far slower than a unit test.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    passWithNoTests: true,
  },
});
