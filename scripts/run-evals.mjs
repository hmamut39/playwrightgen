import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { compareWithBaseline, gateReport } from "./eval-gate.mjs";

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
 *
 * The exception is the baseline: what each case is expected to do, which is a
 * decision rather than a measurement and is committed as one. `--accept`
 * moves it, deliberately and by hand. Without it a run that breaks a case
 * that was passing exits non-zero -- and a run where a known-failing case
 * keeps failing does not, because this suite holds measurements of things the
 * model does badly and deleting them to keep a green light would delete the
 * only thing they know.
 */

const RESULTS = join(process.cwd(), "evals", "results");
const RAW = join(RESULTS, ".raw.json");

mkdirSync(RESULTS, { recursive: true });

const argv = process.argv.slice(2);
const accept = argv.includes("--accept");
const passthrough = argv.filter((argument) => argument !== "--accept");
const BASELINE = join(RESULTS, "baseline.json");

// Vitest's own entry, run by this Node rather than through npx. A .cmd shim
// cannot be spawned on Windows without a shell, and passing an args array
// through a shell concatenates rather than escapes them.
const vitest = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));

const child = spawn(
  process.execPath,
  [
    vitest,
    "run",
    "--config",
    "vitest.evals.config.ts",
    ...passthrough,
    "--reporter=default",
    "--reporter=json",
    `--outputFile.json=${RAW}`,
  ],
  // npx.cmd is executable directly on Windows, so no shell is needed. Passing
  // an args array through a shell concatenates rather than escapes them, which
  // Node warns about and which there is no reason to accept here.
  { stdio: "inherit" },
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
      // Kept because these cases fail intermittently, and a run that says
      // only "failed" cannot be diagnosed later: by the time anybody looks,
      // the model has answered differently and the evidence is gone.
      ...(test.status === "passed"
        ? {}
        : { failure: (test.failureMessages ?? []).join("\n").slice(0, 4_000) }),
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

  const baseline = readBaseline();
  if (accept || !baseline) {
    writeFileSync(BASELINE, JSON.stringify({ blessedAt: run.ranAt, cases: run.cases.map(({ file, name, status }) => ({ file, name, status })) }, null, 2));
    console.log(
      baseline
        ? "\nBaseline moved to this run, by hand. Every case here is now what is expected."
        : "\nNo baseline existed. This run is now the baseline; check it reads the way you meant.",
    );
    process.exit(0);
  }

  const comparison = compareWithBaseline(run, baseline);
  const gate = gateReport(comparison);
  console.log(`\nAgainst the baseline blessed at ${baseline.blessedAt ?? "an unknown time"}:`);
  console.log(gate.lines.length ? gate.lines.join("\n") : "  nothing changed against it.");
  if (!gate.ok) {
    console.log("\nThis run is worse than the baseline. Fix it, or move the baseline with --accept and say why.");
    process.exit(1);
  }
  console.log("\nNo case did worse than the baseline.");
  // Deliberately not vitest's code: a case this suite expects to fail is not
  // a failure of the run, and a gate that cannot tell the two apart gates
  // nothing.
  process.exit(0);
});

/** What each case is expected to do, moved only by hand. */
function readBaseline() {
  try {
    return JSON.parse(readFileSync(BASELINE, "utf8"));
  } catch {
    return null;
  }
}

/** The most recent archived run, if there is one to compare against. */
function readPrevious() {
  const archived = readdirSync(RESULTS)
    // Not the baseline, which lives here too and carries no score: reading
    // it as a previous run crashed the reporter, and would have taken the
    // weekly job down on its first real run.
    .filter((name) => name.endsWith(".json") && name !== "latest.json" && name !== "baseline.json")
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
  for (const entry of broke) {
    console.log(`  now failing: ${entry.file} · ${entry.name}`);
    if (entry.failure) console.log(`    ${entry.failure.split("\n")[0]}`);
  }
  for (const entry of fixed) console.log(`  now passing: ${entry.file} · ${entry.name}`);
  if (broke.length === 0 && fixed.length === 0) {
    console.log("  No case changed side.");
  }
  console.log("Recorded in evals/results/");
}
