/**
 * What an eval run is allowed to be, measured against a blessed baseline.
 *
 * The runner already said which cases changed side, but it compared each run
 * with the one before it. That ratchets: a case breaks, the run is archived,
 * and the next run compares against the broken one and reports nothing wrong.
 * The regression becomes the new normal without anybody deciding it should.
 *
 * So the comparison is against a baseline that only moves when somebody moves
 * it. A case that was passing and now fails is a regression and fails the
 * gate. A case that is expected to fail and still fails is not: this suite
 * holds measurements of things a model does badly, and deleting them to keep
 * a green light would delete the only thing they know. A case nobody has seen
 * before cannot regress, so it is reported and does not gate.
 */

/** @typedef {{ file: string, name: string, status: string, failure?: string }} EvalCase */
/** @typedef {{ ranAt?: string, score?: { passed: number, total: number }, cases: EvalCase[] }} EvalRun */

const key = (entry) => `${entry.file}::${entry.name}`;

export function compareWithBaseline(run, baseline) {
  const expected = new Map((baseline?.cases ?? []).map((entry) => [key(entry), entry.status]));

  /** @type {EvalCase[]} */ const regressions = [];
  /** @type {EvalCase[]} */ const recoveries = [];
  /** @type {EvalCase[]} */ const unseen = [];
  for (const entry of run.cases) {
    const was = expected.get(key(entry));
    if (was === undefined) {
      unseen.push(entry);
      continue;
    }
    if (was === "passed" && entry.status !== "passed") regressions.push(entry);
    if (was !== "passed" && entry.status === "passed") recoveries.push(entry);
  }

  // A case the baseline expects from a file this run did report, which did
  // not appear. Renaming a case looks exactly like deleting one from here,
  // and a suite that quietly stops running a measurement is the thing this
  // file exists to catch.
  //
  // Bounded to the files that ran, because running one file on purpose is
  // ordinary -- and a gate that calls every other file "not run" is a false
  // alarm, which is how a gate teaches people to ignore it.
  const ran = new Set(run.cases.map(key));
  const filesRun = new Set(run.cases.map((entry) => entry.file));
  const missing = (baseline?.cases ?? []).filter(
    (entry) => filesRun.has(entry.file) && !ran.has(key(entry)),
  );

  // A run that reported nothing at all, against a baseline that expects
  // something. Narrowing "missing" to the files that ran would otherwise let
  // a suite that failed to start pass quietly, which is the worst of both.
  const ranNothing = run.cases.length === 0 && (baseline?.cases ?? []).length > 0;

  return { regressions, recoveries, unseen, missing, ranNothing };
}

/** One line per thing worth knowing, and whether the gate holds. */
export function gateReport(comparison) {
  const lines = [];
  for (const entry of comparison.regressions) {
    lines.push(`  REGRESSED  ${entry.file} · ${entry.name}`);
    if (entry.failure) lines.push(`    ${entry.failure.split("\n")[0]}`);
  }
  for (const entry of comparison.recoveries) lines.push(`  recovered  ${entry.file} · ${entry.name}`);
  for (const entry of comparison.unseen) {
    lines.push(`  new        ${entry.file} · ${entry.name} (${entry.status})`);
  }
  for (const entry of comparison.missing) {
    lines.push(`  NOT RUN    ${entry.file} · ${entry.name} — in the baseline, absent from this run`);
  }
  if (comparison.ranNothing) {
    lines.push("  NOTHING RAN  the baseline expects cases and this run reported none.");
  }
  return {
    lines,
    // A measurement that stopped running is as bad as one that broke: both
    // leave somebody believing in a check that is not happening.
    ok:
      comparison.regressions.length === 0 &&
      comparison.missing.length === 0 &&
      !comparison.ranNothing,
  };
}
