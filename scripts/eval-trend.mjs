#!/usr/bin/env node
/**
 * How each eval case has behaved across every run anybody kept.
 *
 * The gate compares one run with a blessed baseline, which answers "is this
 * run allowed". It cannot answer "has this case been telling the truth", and
 * that is the question the score hides. Across the six runs CI kept between
 * 19 October and 16 November the score read 50/55, 52/55, 51/55, 51/57,
 * 54/57, 56/57 -- a tidy climb -- while four separate cases changed side
 * underneath it, one of them three times. A suite whose membership is stable
 * and whose verdicts are not looks exactly like a suite that is improving.
 *
 * So this reads every run it can find and reports per case, not per run.
 *
 * Three distinctions it refuses to flatten:
 *
 * - A case that was skipped and is now measured has not changed side. The
 *   live-page evals skipped for weeks without a remote browser key and then
 *   started passing; counted naively that is the biggest "flip" in the suite,
 *   and it is not a flip at all. It is the measurement beginning.
 * - A case that was measured and is now skipped is worth saying out loud,
 *   because a measurement that quietly stopped is the fault this product
 *   sells the cure for.
 * - A case measured twice cannot support the word flaky. The report says how
 *   many runs it is speaking from, every time, and says less when it knows
 *   less.
 *
 * And it does not claim to know why a case moved. These runs span real code
 * and prompt changes, so a flip may be a fix, a regression, or the model
 * being the model. What it proves is narrower and enough: the score did not
 * tell you.
 *
 * Where the runs come from. `evals/results/*` is excluded from version
 * control on purpose -- one afternoon's measurement is not a fact about the
 * repository -- so the local directory holds only this machine's runs, mostly
 * filtered ones. The full suite runs weekly in CI, which uploads the scores
 * as a workflow artifact that nothing has ever read and that expires after 90
 * days. `--ci` reads those, and `--record` folds whatever was read into
 * `evals/results/history.json`, which is committed, so the series outlives
 * the artifacts.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PASSED = "passed";
const SKIPPED = "skipped";

/** @typedef {{ file: string, name: string, status: string }} EvalCase */
/** @typedef {{ ranAt: string, score?: { passed: number, total: number }, cases: EvalCase[] }} EvalRun */

const key = (entry) => `${entry.file}::${entry.name}`;

/**
 * Every run worth reading, oldest first, each counted once.
 *
 * The same measurement reaches this from several directions: the dated
 * archive, `latest.json` beside it, and the copies of both inside a CI
 * artifact. Counting one run twice would invent a transition out of nothing,
 * so runs are identified by when they ran. When two copies disagree on size
 * the larger wins, because the smaller is a truncated or partial write and
 * the missing cases would read as a measurement that stopped.
 */
export function orderRuns(runs) {
  const byRanAt = new Map();
  for (const run of runs ?? []) {
    if (!run || typeof run.ranAt !== "string" || !Array.isArray(run.cases)) continue;
    // A run that measured nothing -- a suite that failed to start, an
    // interrupted one -- is a real event and tells a trend nothing. Left in,
    // it prints a 0/0 in the score column that reads as a catastrophe.
    // Whether a run reported nothing is the gate's business, not this one's.
    if (run.cases.length === 0) continue;
    const existing = byRanAt.get(run.ranAt);
    if (!existing || existing.cases.length < run.cases.length) byRanAt.set(run.ranAt, run);
  }
  return [...byRanAt.values()].sort((a, b) => a.ranAt.localeCompare(b.ranAt));
}

const mark = (status) => (status === PASSED ? "." : status === SKIPPED ? "-" : "X");

/**
 * Whether two runs measured the same code, which is the only way to be sure
 * a disagreement belongs to the model.
 *
 * Both halves are required. A run with uncommitted changes measured code
 * that exists nowhere else, so two dirty runs sharing a sha may have been
 * measuring two different things -- and that is precisely the conclusion a
 * reader would draw wrongly if the sha alone were trusted. Runs recorded
 * before any of this was kept carry no commit at all, and absent is not
 * equal: saying nothing is the only honest answer about them.
 */
const sameCode = (before, after) =>
  Boolean(before?.sha) && before.sha === after?.sha && !before.dirty && !after.dirty;

/** One case's whole life, and what can honestly be said about it. */
function describe(entry) {
  const measured = entry.points.filter((point) => point.status !== SKIPPED);

  // Transitions between consecutive *measurements*. Skipped runs are not
  // points on the line; they are gaps in it, and joining across a gap is the
  // only way to avoid reporting "started being measured" as instability.
  let flips = 0;
  const changes = [];
  for (let i = 1; i < measured.length; i += 1) {
    const was = measured[i - 1].status === PASSED;
    const now = measured[i].status === PASSED;
    if (was === now) continue;
    flips += 1;
    /*
     * Whether the two runs that disagreed happened on the same day.
     *
     * This is the only distinction in the data that carries real weight. A
     * case that passes one week and fails the next may have been broken by
     * any of the commits in between, and usually was. Two runs a few hours
     * apart disagreeing is a different claim: on 15 November the suite
     * scored 54/57, then 56/57, then 54/57, and nothing was released
     * between them. No change to the code explains that, so it is the
     * nearest thing here to proof that a case is not deciding on the
     * evidence in front of it.
     *
     * Calendar date rather than elapsed time, because that is what a reader
     * can check against their own memory of the day.
     */
    changes.push({
      at: measured[i].ranAt,
      to: measured[i].status,
      sameDay: measured[i].ranAt.slice(0, 10) === measured[i - 1].ranAt.slice(0, 10),
      sameCommit: sameCode(measured[i - 1].commit, measured[i].commit),
    });
  }

  const last = entry.points.at(-1);
  return {
    file: entry.file,
    name: entry.name,
    points: entry.points,
    shape: entry.points.map((point) => mark(point.status)).join(""),
    runs: entry.points.length,
    measured: measured.length,
    flips,
    changes,
    sameDayFlips: changes.filter((change) => change.sameDay).length,
    sameCommitFlips: changes.filter((change) => change.sameCommit).length,
    status: last.status,
    // Skipped before it was ever measured: the measurement began, which is
    // the opposite of a case going bad.
    startedLate: entry.points.findIndex((point) => point.status !== SKIPPED) > 0,
    // Measured before and skipped now: a check somebody still believes in.
    stopped: last.status === SKIPPED && measured.length > 0,
  };
}

/** Each case in the suite, the least trustworthy first. */
export function caseHistories(runs) {
  const ordered = orderRuns(runs);
  /** @type {Map<string, { file: string, name: string, points: Array<{ ranAt: string, status: string }> }>} */
  const byCase = new Map();
  for (const run of ordered) {
    for (const entry of run.cases) {
      const id = key(entry);
      if (!byCase.has(id)) byCase.set(id, { file: entry.file, name: entry.name, points: [] });
      byCase.get(id).points.push({ ranAt: run.ranAt, status: entry.status, commit: run.commit ?? null });
    }
  }
  return [...byCase.values()].map(describe).sort(
    (a, b) =>
      // Two answers to the same code first: that is the one movement here no
      // commit can account for, and the one worth a person's morning. The
      // calendar date is the fallback for runs recorded before the commit
      // was kept -- weaker, because a same-day pair can still straddle a
      // change, and ordered below it for that reason.
      b.sameCommitFlips - a.sameCommitFlips ||
      b.sameDayFlips - a.sameDayFlips ||
      b.flips - a.flips ||
      a.file.localeCompare(b.file) ||
      a.name.localeCompare(b.name),
  );
}

/** "3 runs" / "1 run", because "1 runs" is how a reader learns to skim. */
const runWord = (count) => `${count} run${count === 1 ? "" : "s"}`;

/**
 * What the series says, in the order a reader needs it.
 *
 * The headline is deliberately not the score. A case that flips and happens
 * to be green on the day the baseline is blessed becomes a case the gate
 * expects to pass, so its next failure arrives as a regression and gets
 * investigated as a change somebody made. That is a week of looking for a
 * cause that was never there, and this report exists so the suspicion lands
 * in the right place first.
 */
export function trendReport(runs) {
  const ordered = orderRuns(runs);
  const histories = caseHistories(ordered);
  const lines = [];

  if (ordered.length === 0) {
    lines.push("No eval runs found.");
    lines.push("Run `npm run evals` locally, or `--ci` to read the scores CI kept.");
    return { lines, histories, runs: ordered };
  }

  lines.push(
    `Read ${runWord(ordered.length)}, ${ordered[0].ranAt.slice(0, 10)} to ${ordered.at(-1).ranAt.slice(0, 10)}.`,
  );
  for (const run of ordered) {
    const passed = run.score?.passed ?? run.cases.filter((entry) => entry.status === PASSED).length;
    const total = run.score?.total ?? run.cases.length;
    // Where the run came from, because a reader comparing 3/4 with 51/57
    // down one column deserves to know the first was somebody running a
    // single file on their laptop. Per case this does not matter -- a case is
    // only ever compared with runs that measured it -- but the score column
    // is read top to bottom and would otherwise look like a collapse.
    const origin = run.origin === "ci" ? "weekly  " : run.origin === "local" ? "local   " : "        ";
    lines.push(`  ${run.ranAt.slice(0, 16).replace("T", " ")}  ${origin}${passed}/${total}`);
  }
  const whole = ordered.filter((run) => run.origin === "ci").length;
  if (whole > 0 && whole < ordered.length) {
    lines.push(
      `  ${whole} of these ran the whole suite in CI; the rest are local runs, ` +
        "most of them one file at a time.",
    );
  }

  if (ordered.length === 1) {
    lines.push("");
    lines.push("One run is not a trend. Nothing below can be said yet.");
    return { lines, histories, runs: ordered };
  }

  const flipping = histories.filter((entry) => entry.flips > 0);
  const started = histories.filter((entry) => entry.startedLate);
  const stopped = histories.filter((entry) => entry.stopped);

  lines.push("");
  if (flipping.length === 0) {
    lines.push(`No case changed side across these ${runWord(ordered.length)}.`);
  } else {
    lines.push(
      `${flipping.length} of ${histories.length} cases changed side at least once. ` +
        "Legend: . passed  X did not pass  - skipped, oldest run first.",
    );
    for (const entry of flipping) {
      // One line per case. The warnings that apply to most of them are said
      // once underneath instead: the first draft of this printed "passing
      // now, so the baseline will read its next failure as a regression" ten
      // times in a row, which is how a report teaches someone to skim past
      // the line that mattered.
      const how =
        entry.sameCommitFlips > 0
          ? `, ${entry.sameCommitFlips} on the same commit`
          : entry.sameDayFlips > 0
            ? `, ${entry.sameDayFlips} within one day`
            : "";
      const thin = entry.measured < 3 ? "  (measured twice -- too few to call flaky)" : "";
      lines.push(`  ${entry.shape}  ${entry.flips}x${how}  ${entry.file} · ${entry.name}${thin}`);
    }

    lines.push("");
    const green = flipping.filter((entry) => entry.status === PASSED);
    if (green.length > 0) {
      lines.push(
        green.length === flipping.length
          ? `All ${green.length} are passing today, so the baseline will read their next failure as a regression even where nothing changed.`
          : `${green.length} of the ${flipping.length} are passing today, so the baseline will read their next failure as a regression even where nothing changed.`,
      );
    }

    lines.push(
      "These runs span real code and prompt changes, so a change of side may be a fix, " +
        "a regression, or the model being the model.",
    );

    /*
     * The strongest claim the records support, and not a word more.
     *
     * The first version of this said that a case disagreeing with itself
     * twice in one day "cannot be the work of a commit". That was not true
     * and the data could not have shown it either way: three runs on 15
     * November were hours apart on a day with several commits, and nothing
     * in the file said which commit any of them measured. Two answers to
     * the same clean commit is the claim worth making, so `npm run evals`
     * now records the sha and whether the tree was dirty -- and until a
     * second run of one commit exists, this says what it actually knows.
     */
    const sameCommit = flipping.filter((entry) => entry.sameCommitFlips > 0);
    const sameDay = flipping.filter((entry) => entry.sameDayFlips > 0);
    const withCommit = ordered.filter((run) => run.commit?.sha).length;

    if (sameCommit.length > 0) {
      lines.push(
        `${sameCommit.length} of them gave two different answers to the same commit, with ` +
          "nothing changed in between. That is the model, not a regression.",
      );
    } else if (withCommit < 2) {
      lines.push(
        `${withCommit === 0 ? "None of these runs recorded" : "Only one of these runs recorded"} ` +
          "which commit it measured, so none of the above can be pinned on the model yet. " +
          "Runs from here on record it.",
      );
      if (sameDay.length > 0) {
        lines.push(
          `${sameDay.length} did change side twice within a single day, which is suggestive ` +
            "and no more: a day can hold several commits, and these days did.",
        );
      }
    } else {
      lines.push(
        "No case gave two different answers to the same commit, so every change of side here " +
          "could be the work of a change between the runs rather than the model.",
      );
    }
    // Computed, not written down. The first draft of this line said "the
    // score moved 50 to 56", which was true of the afternoon it was written
    // and would have been a fabrication on every run after it.
    const comparable = ordered.filter((run) => run.origin === "ci");
    const ends = comparable.length >= 2 ? comparable : ordered;
    const score = (run) =>
      `${run.score?.passed ?? run.cases.filter((entry) => entry.status === PASSED).length}/${run.score?.total ?? run.cases.length}`;
    lines.push(
      `Either way the score said none of it: it went ${score(ends[0])} to ${score(ends.at(-1))} ` +
        "across these runs while the cases above changed sides underneath it.",
    );
  }

  if (started.length > 0 || stopped.length > 0) {
    lines.push("");
    for (const entry of started) {
      lines.push(
        `  began being measured  ${entry.shape}  ${entry.file} · ${entry.name}` +
          ` -- skipped in earlier runs, so it did not change side`,
      );
    }
    for (const entry of stopped) {
      lines.push(
        `  STOPPED being measured  ${entry.shape}  ${entry.file} · ${entry.name}` +
          ` -- it ran before and is skipped now`,
      );
    }
  }

  return { lines, histories, runs: ordered };
}

/**
 * The committed series, after folding in whatever was just read.
 *
 * Only file, name and status are kept. A failure string carries the absolute
 * path of whichever machine ran it, down to a home directory name, and this
 * file goes into version control; the stack trace also dwarfs everything
 * else in it. What a trend needs is which side the case came down on.
 */
export function mergedHistory(existing, runs) {
  const before = orderRuns(existing?.runs ?? []);
  const known = new Set(before.map((run) => run.ranAt));
  const incoming = orderRuns(runs).filter((run) => run.cases.length > 0);
  const merged = orderRuns([
    ...before,
    ...incoming.map((run) => ({
      ranAt: run.ranAt,
      // Kept because it is the difference between a weekly run of 57 cases
      // and somebody re-running one file, and because once the artifact it
      // came from has expired there is no other way to find out.
      ...(run.origin ? { origin: run.origin } : {}),
      // Which code was measured, without which a disagreement cannot be told
      // from a change. Kept verbatim, including dirty: a run of uncommitted
      // code is a measurement of something that exists nowhere else.
      ...(run.commit ? { commit: run.commit } : {}),
      score: {
        passed: run.score?.passed ?? run.cases.filter((entry) => entry.status === PASSED).length,
        total: run.score?.total ?? run.cases.length,
      },
      cases: run.cases.map((entry) => ({ file: entry.file, name: entry.name, status: entry.status })),
    })),
  ]);
  return {
    runs: merged,
    added: merged.filter((run) => !known.has(run.ranAt)).length,
    kept: before.length,
  };
}

// ---------------------------------------------------------------------------
// Reading runs off this machine and out of CI. Not exported: there is nothing
// here a test could assert that would not just be a restatement of the code.
// ---------------------------------------------------------------------------

const RESULTS = join(process.cwd(), "evals", "results");
const HISTORY = join(RESULTS, "history.json");

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

/** Runs archived on this machine. `baseline.json` is a decision, not a run. */
function localRuns() {
  if (!existsSync(RESULTS)) return [];
  return readdirSync(RESULTS)
    .filter((name) => name.endsWith(".json") && name !== "baseline.json" && name !== "history.json")
    .map((name) => readJson(join(RESULTS, name)))
    .filter(Boolean)
    .map((run) => ({ ...run, origin: "local" }));
}

/**
 * The scores CI kept, which are the only full-suite runs that exist.
 *
 * They are workflow artifacts with a 90-day retention, so this is also the
 * last chance to read the October runs before they are gone.
 */
function ciRuns(limit) {
  let listed;
  try {
    listed = execFileSync(
      "gh",
      ["run", "list", "--workflow=evals.yml", "--limit", String(limit), "--json", "databaseId,conclusion"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    console.log("Could not ask GitHub for past eval runs, so this reads only local ones.");
    console.log(`  ${String(error.message ?? error).split("\n")[0]}`);
    return [];
  }

  const ids = JSON.parse(listed).map((run) => run.databaseId);
  const into = mkdtempSync(join(tmpdir(), "eval-trend-"));
  const runs = [];
  let withArtifact = 0;
  try {
    for (const id of ids) {
      const dir = join(into, String(id));
      try {
        execFileSync("gh", ["run", "download", String(id), "--name", "eval-scores", "--dir", dir], {
          stdio: "ignore",
        });
      } catch {
        // A failed run, or one whose artifact has expired. Ordinary.
        continue;
      }
      withArtifact += 1;
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json") || name === "baseline.json") continue;
        if (!statSync(join(dir, name)).isFile()) continue;
        const run = readJson(join(dir, name));
        if (run) runs.push({ ...run, origin: "ci" });
      }
    }
  } finally {
    rmSync(into, { recursive: true, force: true });
  }
  console.log(`Read ${withArtifact} of ${ids.length} CI runs; the rest failed or their scores expired.`);
  return runs;
}

// Whether this file was run or imported. Built by hand first --
// `file://${argv[1]}` -- which on Windows is short one slash and leaves the
// drive letter's colon unencoded, so the comparison was false on every run
// and the script printed nothing, successfully and silently. The same shape
// of fault the report below exists to catch.
if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  const argv = process.argv.slice(2);
  const wantsCi = argv.includes("--ci");
  const wantsRecord = argv.includes("--record");

  const stored = readJson(HISTORY);
  const collected = [...(stored?.runs ?? []), ...localRuns(), ...(wantsCi ? ciRuns(30) : [])];

  const report = trendReport(collected);
  console.log("");
  for (const line of report.lines) console.log(line);

  if (wantsRecord) {
    const merged = mergedHistory(stored, collected);
    writeFileSync(
      HISTORY,
      `${JSON.stringify({ recordedAt: new Date().toISOString(), runs: merged.runs }, null, 2)}\n`,
      "utf8",
    );
    console.log("");
    console.log(
      `Recorded ${merged.added} new run${merged.added === 1 ? "" : "s"} in evals/results/history.json ` +
        `(${merged.runs.length} in all). Commit it: the CI artifacts it came from expire after 90 days.`,
    );
  } else if (report.runs.length > 0) {
    console.log("");
    console.log("Pass --record to keep these in evals/results/history.json, --ci to include CI's runs.");
  }
}
