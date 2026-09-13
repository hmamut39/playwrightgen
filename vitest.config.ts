import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

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
    setupFiles: ["./tests/setup.ts"],
    include: [
      "lib/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}",
    ],
    passWithNoTests: true,
    // Integration tests make a dozen or more round trips to a remote Postgres
    // each, and under the full suite's load that database answers slowly
    // enough to push a correct test past the five-second default -- which then
    // leaves its rows half cleaned and fails the next test on a foreign key.
    // Those failures moved between files from one run to the next and every
    // file passed alone, so the limit was measuring network latency rather than
    // behaviour. The allowance reflects the environment; no assertion changed.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "html", "json-summary"],
    },
  },
});
