import { defineConfig } from "@playwright/test";

/**
 * Configured so a failing test leaves evidence behind.
 *
 * The defaults keep almost nothing, which is fine locally and useless in CI:
 * the runner is destroyed when the job ends, so anything not written to disk
 * and uploaded is gone. These three settings are what make a trace, screenshot
 * and video exist for PlaywrightGen to attach to the failed attempt.
 */
export default defineConfig({
  testDir: "./tests",
  reporter: "json",
  outputDir: "test-results",
  use: {
    // The address under test, which the workflow passes in from this
    // repository's BASE_URL variable. A test PlaywrightGen wrote opens './',
    // relative to this, so without it the run reports a skip or a failure
    // about the missing address rather than about the application. A
    // repository that tests one fixed site can write the address here
    // instead.
    baseURL: process.env.BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
