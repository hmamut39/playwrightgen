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
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
