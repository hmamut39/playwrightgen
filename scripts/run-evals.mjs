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
 *
 * A case that regresses is asked again before it counts. The paragraph above
 * knew the suite was stochastic -- "one run in three" -- and the gate failed
 * the build on one sample anyway. See `confirm`.
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

/** One line per case, which is the unit a person reasons about. */
function toCases(raw) {
  return (raw.testResults ?? []).flatMap((file) =>
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
}

/** Runs the suite once. Separated so a case can be asked twice. */
function runOnce(extraArgs = []) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        vitest,
        "run",
        "--config",
        "vitest.evals.config.ts",
        ...passthrough,
        ...extraArgs,
        "--reporter=default",
        "--reporter=json",
        `--outputFile.json=${RAW}`,
      ],
      // npx.cmd is executable directly on Windows, so no shell is needed.
      { stdio: "inherit" },
    );
    child.on("exit", (code) => {
      let raw = null;
      try {
        raw = JSON.parse(readFileSync(RAW, "utf8"));
      } catch {
        resolve({ code: code ?? 1, cases: null });
        return;
      }
      rmSync(RAW, { force: true });
      resolve({ code: code ?? 0, cases: toCases(raw) });
    });
  });
}

/**
 * Asks the cases that regressed to do it again.
 *
 * The gate failed the build on a single sample of a language model. On
 * 2026-11-02 it reported one regression and two new failures. Run again on
 * 2026-11-07, with nothing in between touching the code they measure, the
 * regression passed five times out of five and one of the new failures three
 * out of three. Two of its three findings were the model answering
 * differently, and the gate called the first of them REGRESSED.
 *
 * That is the mistake this product exists to stop its customers making: a
 * result that is not reproducible is not a verdict. It is also why that red
 * gate sat unread for five days. A gate that cries wolf teaches people to
 * ignore it, which this repository had already written down about a different
 * false alarm and had not applied here.
 *
 * So a regression is asked again before it counts. Only the files holding one
 * are re-run, because that is cheap and nothing else is in question. A case
 * that passes the second time does not fail the build, and is still printed:
 * an eval that answers differently on one input is a problem of its own, just
 * not the one this gate is for.
 */
async function confirm(regressions) {
  const files = [...new Set(regressions.map((entry) => entry.file))];
  const plural = regressions.length === 1 ? "" : "s";
  console.log(`\nAsking ${regressions.length} regressed case${plural} again, in ${files.join(", ")}.`);

  const second = await runOnce(files.map((file) => `evals/${file}`));
  if (!second.cases) {
    console.log("  The second run produced no output, so the first answer stands.");
    return { confirmed: regressions, flaky: [] };
  }

  const again = new Map(second.cases.map((entry) => [`${entry.file}::${entry.name}`, entry.status]));
  const confirmed = [];
  const flaky = [];
  for (const entry of regressions) {
    // Absent from the second run means it was never asked, so the first
    // answer is the only one there is.
    if (again.get(`${entry.file}::${entry.name}`) === "passed") flaky.push(entry);
    else confirmed.push(entry);
  }
  return { confirmed, flaky };
}

const first = await runOnce();
if (!first.cases) {
  console.log("\nNo eval output to record.");
  process.exit(first.code || 1);
}

const cases = first.cases;
const passed = cases.filter((entry) => entry.status === "passed").length;
const run = { ranAt: new Date().toISOString(), score: { passed, total: cases.length }, cases };

const previous = readPrevious();
writeFileSync(join(RESULTS, `${run.ranAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(run, null, 2));
writeFileSync(join(RESULTS, "latest.json"), JSON.stringify(run, null, 2));

report(run, previous);

const baseline = readBaseline();
if (accept || !baseline) {
  writeFileSync(
    BASELINE,
    JSON.stringify(
      { blessedAt: run.ranAt, cases: run.cases.map(({ file, name, status }) => ({ file, name, status })) },
      null,
      2,
    ),
  );
  console.log(
    baseline
      ? "\nBaseline moved to this run, by hand. Every case here is now what is expected."
      : "\nNo baseline existed. This run is now the baseline; check it reads the way you meant.",
  );
  process.exit(0);
}

const comparison = compareWithBaseline(run, baseline);
console.log(`\nAgainst the baseline blessed at ${baseline.blessedAt ?? "an unknown time"}:`);
const gate = gateReport(comparison);
console.log(gate.lines.length ? gate.lines.join("\n") : "  nothing changed against it.");

let confirmedRegressions = comparison.regressions;
if (comparison.regressions.length > 0) {
  const { confirmed, flaky } = await confirm(comparison.regressions);
  confirmedRegressions = confirmed;
  for (const entry of flaky) {
    console.log(`  NOT REPRODUCIBLE  ${entry.file} · ${entry.name}`);
    console.log("    It failed once and passed when asked again, so it is not a regression.");
    console.log("    An eval that answers differently on one input is worth fixing on its own.");
  }
  if (confirmed.length > 0) {
    const plural = confirmed.length === 1 ? "" : "s";
    console.log(`\n  ${confirmed.length} case${plural} failed twice:`);
    for (const entry of confirmed) console.log(`    ${entry.file} · ${entry.name}`);
  }
}

// A regression that held, or anything else the gate objects to. The gate's
// other objections -- a case the baseline expects that nobody ran -- are not
// about the model and are not re-run.
const stillBad = !gate.ok && (confirmedRegressions.length > 0 || comparison.regressions.length === 0);
if (stillBad) {
  console.log("\nThis run is worse than the baseline. Fix it, or move the baseline with --accept and say why.");
  process.exit(1);
}
console.log(
  comparison.regressions.length > 0
    ? "\nNo case did worse than the baseline twice."
    : "\nNo case did worse than the baseline.",
);
// Deliberately not vitest's code: a case this suite expects to fail is not
// a failure of the run, and a gate that cannot tell the two apart gates
// nothing.
process.exit(0);

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

  console.log(`Previous: ${previous.score.passed}/${previous.score.total} at ${previous.ranAt}`);
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
