import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Set by `next upgrade --agent=security` on 2026-10-28, taking 16.4.0 to
   * 16.4.3. 16.4.0 was inside the range of a published critical advisory --
   * unauthenticated remote code execution through the image optimisation API
   * when SVG files are involved, and a denial of service in App Router server
   * actions. This app uses server actions throughout.
   */
  experimental: {
    agentUpgrade: "security",
  },
  // The pipeline templates are read from disk at request time, so nothing
  // static analysis can see tells the build they are needed. Without this they
  // are left out of the deployment and the download 500s in production only --
  // which is the worst place to find out.
  outputFileTracingIncludes: {
    "/ci/[...file]": ["./templates/**/*"],
    /**
     * playwright-core reads this at import, by a path the build cannot see.
     *
     * Every route that opens a browser -- the live runner, Quick Generate,
     * draft repair, covering a page, and the MCP server -- failed on the
     * deployment with `Cannot find module
     * node_modules/playwright-core/browsers.json`, a 500 with an empty body
     * before the handler ran. It broke with the upgrade to Playwright 1.65 on
     * 2026-11-07, which moved the browser registry into `coreBundle.js` and
     * loads the file through a computed path; 1.58 did not. Tracing pulls in
     * 90 of the package's files and missed the one kilobyte that decides
     * whether any of them load.
     *
     * It could only fail on a deployment, which is why nothing caught it: the
     * file is on disk locally, so `npm run dev`, every test and the
     * production build all pass.
     */
    "**": ["./node_modules/playwright-core/browsers.json"],
  },
  /**
   * What the deployed functions do not need to carry.
   *
   * The preview runner parses a generated test with the TypeScript compiler
   * API rather than executing it, so `typescript` is a genuine runtime
   * dependency of four functions. The package also ships the command-line
   * compiler and its error messages translated into fourteen languages, and
   * tracing pulled all of it in: 19MB per function where the parser needs
   * about 9MB.
   *
   * It is worth caring about because a deployment keeps its functions. Vercel
   * reported this account at 100% of its 10GB function storage on
   * 2026-10-18, after a day of deploying on every commit -- several hundred
   * megabytes a deployment, most of it the same compiler copied four times.
   */
  outputFileTracingExcludes: {
    "**": [
      "node_modules/typescript/lib/_tsc.js",
      "node_modules/typescript/lib/tsc.js",
      "node_modules/typescript/lib/tsserver.js",
      "node_modules/typescript/lib/tsserverlibrary.js",
      "node_modules/typescript/lib/typingsInstaller.js",
      "node_modules/typescript/lib/typescriptServices.js",
      // English is compiled in; a server has no locale to show them in.
      "node_modules/typescript/lib/*/diagnosticMessages.generated.json",
    ],
  },
  async redirects() {
    return [
      // Coverage Review lived at /intelligence, which named the machinery
      // rather than the job. The old address keeps working for anyone who
      // linked or bookmarked it.
      { source: "/intelligence", destination: "/coverage-review", permanent: true },
    ];
  },
};

export default nextConfig;
