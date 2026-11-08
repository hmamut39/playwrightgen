import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * Checks that each deployed function carries the files it loads at runtime.
 *
 * Next decides what to ship per function by tracing imports. A dependency that
 * reads a file through a computed path is invisible to that trace, so the file
 * is left out and the function throws on its first call -- on the deployment
 * only. Locally the file is on disk, so `next dev`, every test and the
 * production build all pass.
 *
 * That happened on 2026-11-07: Playwright 1.65 moved its browser registry into
 * `coreBundle.js`, which loads `browsers.json` by a path the build cannot see.
 * Every route that opens a browser -- the live runner, Quick Generate, draft
 * repair, covering a page, the MCP server -- answered 500 with an empty body
 * before the handler ran, and the home page's own "run it on your real page"
 * was dead for a day. Nothing in the repository could have known: the only
 * place the fault exists is the deployment.
 *
 * So this reads the trace the build just wrote and asks the one question the
 * tests cannot: when a function carries this package, does it carry the file
 * the package needs in order to load at all?
 *
 *   npm run build && node scripts/check-deployment-trace.mjs
 */

const TRACE_ROOT = ".next/server";

/** A file a package reads at runtime, which must travel with it. */
const REQUIRED = [
  {
    package: "playwright-core",
    file: "playwright-core/browsers.json",
    why: "playwright-core reads it at import; without it nothing that opens a browser loads",
  },
];

async function traceFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await traceFiles(path)));
    else if (entry.name.endsWith(".nft.json")) found.push(path);
  }
  return found;
}

let traces;
try {
  traces = await traceFiles(TRACE_ROOT);
} catch {
  console.error(`No build output in ${TRACE_ROOT}. Run \`npm run build\` first.`);
  process.exit(1);
}

if (traces.length === 0) {
  console.error(`No trace files under ${TRACE_ROOT}, so nothing could be checked.`);
  process.exit(1);
}

const failures = [];
let carrying = 0;

for (const trace of traces) {
  const { files } = JSON.parse(await readFile(trace, "utf8"));
  const normalised = files.map((file) => file.replace(/\\/g, "/"));
  for (const required of REQUIRED) {
    const usesPackage = normalised.some((file) => file.includes(`node_modules/${required.package}/`));
    if (!usesPackage) continue;
    carrying += 1;
    if (!normalised.some((file) => file.endsWith(required.file))) {
      failures.push({ trace: relative(TRACE_ROOT, trace), required });
    }
  }
}

console.log(`Checked ${traces.length} traced functions; ${carrying} load a package with a runtime data file.`);

if (failures.length > 0) {
  console.error(`\n${failures.length} function${failures.length === 1 ? "" : "s"} would fail on the deployment:\n`);
  for (const { trace, required } of failures.slice(0, 10)) {
    console.error(`  ${trace}`);
    console.error(`    missing ${required.file} -- ${required.why}`);
  }
  if (failures.length > 10) console.error(`  and ${failures.length - 10} more`);
  console.error(
    "\nAdd the file to outputFileTracingIncludes in next.config.ts under a route" +
      "\nglob that covers these functions, then build again.",
  );
  process.exit(1);
}

console.log("Every one of them carries it.");
