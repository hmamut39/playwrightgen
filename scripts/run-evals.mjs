import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Runs the evals and keeps the score, so one run can be compared with the next.
 *
 * The suite already graded every surface and printed the result to the
 * console, where it was read once and lost. That is enough to answer "is it
 * right today" and nothing else: a prompt was changed on 2026-10-11 with no
 * way to tell whether outputs got better or worse, and the live-page eval
 * turned out to pass on one run in three without anybody being able to say
 * whether that was new.
 *
 * So each run is archived and compared with the one before it. The comparison
 * is the point: a single score means little when the thing being measured is a
 * language model, and what matters is which cases changed side.
 *
 * Scores are not committed. A measurement from one model on one afternoon is
 * not a fact about the repository, and a file in version control invites
 * reading it as one.
 */

const RESULTS = join(process.cwd(), "evals", "results");
const RAW = join(RESULTS, ".raw.json");

mkdirSync(RESULTS, { recursive: true });

const passthrough = process.argv.slice(2);

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "vitest",
    "run",
    "--config",
    "vitest.evals.config.ts",
    ...passthrough,
    "--reporter=default",
    "--reporter=json",
    `--outputFile.json=${RAW}`,
  ],
  { stdio: "inherit", shell: process.platform === "win32" },
);

child.on("exit", (code) => {
  let raw;
  try {
    raw = JSON.parse(readFileSync(RAW, "utf8"));
  } catch {
    console.log("\nNo eval output to record.");
    process.exit(code ?? 1);
  }
  rmSync(RAW, { force: true });

  /** One line per case, which is the unit a person reasons about. */
  const cases = (raw.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? []).map((test) => ({
      file: file.name?.split(/[\\/]/).pop() ?? "unknown",
      name: test.fullName ?? test.title,
      status: test.status,
      ms: test.duration ?? null,
    })),
  );

  const passed = cases.filter((entry) => entry.status === "passed").length;
  const run = {
    ranAt: new Date().toISOString(),
    score: { passed, total: cases.length },
    cases,
  };

  const previous = readPrevious();
  writeFileSync(join(RESULTS, `${run.ranAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(run, null, 2));
  writeFileSync(join(RESULTS, "latest.json"), JSON.stringify(run, null, 2));

  report(run, previous);
  process.exit(code ?? 0);
});

/** The most recent archived run, if there is one to compare against. */
function readPrevious() {
  const archived = readdirSync(RESULTS)
    .filter((name) => name.endsWith(".json") && name !== "latest.json")
    .sort();
  const last = archived.at(-1);
  if (!last) return null;
  try {
    return JSON.parse(readFileSync(join(RESULTS, last), "utf8"));
  } catch {
    return null;
  }
}

function report(run, previous) {
  console.log(`\nEval score: ${run.score.passed}/${run.score.total}`);

  if (!previous) {
    console.log("No earlier run to compare against. This one is the baseline.");
    console.log(`Recorded in evals/results/`);
    return;
  }

  const before = new Map(previous.cases.map((entry) => [`${entry.file}::${entry.name}`, entry.status]));
  const broke = [];
  const fixed = [];
  for (const entry of run.cases) {
    const was = before.get(`${entry.file}::${entry.name}`);
    if (was === undefined) continue;
    if (was === "passed" && entry.status !== "passed") broke.push(entry);
    if (was !== "passed" && entry.status === "passed") fixed.push(entry);
  }

  console.log(
    `Previous: ${previous.score.passed}/${previous.score.total} at ${previous.ranAt}`,
  );
  // Which cases changed side, rather than the delta: a score that holds while
  // two cases swap is not the same suite passing.
  for (const entry of broke) console.log(`  now failing: ${entry.file} · ${entry.name}`);
  for (const entry of fixed) console.log(`  now passing: ${entry.file} · ${entry.name}`);
  if (broke.length === 0 && fixed.length === 0) {
    console.log("  No case changed side.");
  }
  console.log("Recorded in evals/results/");
}
