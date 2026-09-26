import type { ReleaseEvidenceReport } from "@/lib/services/release-evidence";

/**
 * The evidence as a file someone can keep.
 *
 * A proof link answers "what was tested" while the link lives. An auditor, a
 * customer's security reviewer or a manager preparing a release record needs
 * the same answer in something they can file: attach to a ticket, store for
 * seven years, print. So the report is also rendered as one self-contained
 * HTML document -- no stylesheet to fetch, no script, no image -- which every
 * browser can save as PDF and every archive can hold.
 *
 * It is a copy of the record, not a new source of truth: the same fields the
 * shared page shows, with the moment it was made written into it, and never
 * any test code.
 */

const escape = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const RESULT_WORD: Record<string, string> = {
  PASSED: "passed",
  FAILED: "failed",
  BLOCKED: "could not run",
  SKIPPED: "was skipped",
};

/** How old the evidence is, said plainly rather than left for the reader. */
export function ageWord(ageDays: number | null) {
  if (ageDays === null) return "never run";
  if (ageDays === 0) return "checked today";
  if (ageDays === 1) return "checked yesterday";
  return `checked ${ageDays} days ago`;
}

const VERDICT_WORD = {
  VERIFIED: "Verified",
  FAILING: "Failing",
  UNVERIFIED: "Not verified",
} as const;

/** A UTC stamp, because a filed document is read in another timezone than it was made. */
function stamp(value: Date) {
  return `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** A file name a person can recognise a year later: project, date, and what it is. */
export function evidenceFileName(report: ReleaseEvidenceReport) {
  const slug = report.project.slug.replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "project";
  return `${slug}-test-evidence-${report.generatedAt.toISOString().slice(0, 10)}.html`;
}

function requirementSection(requirement: ReleaseEvidenceReport["requirements"][number]) {
  const meta = [
    `Version ${requirement.versionNumber}`,
    requirement.externalReference ? escape(requirement.externalReference) : null,
    // The sign-off record a reviewing body asks for: who accepted this, and
    // when. Said here rather than left in an activity log nobody exports.
    requirement.approvedBy
      ? `approved by ${escape(requirement.approvedBy)}${requirement.approvedAt ? ` on ${stamp(requirement.approvedAt)}` : ""}`
      : null,
    ageWord(requirement.ageDays),
  ]
    .filter(Boolean)
    .join(" &middot; ");

  const tests = requirement.testCases.length
    ? `<table>
        <thead><tr><th>Test case</th><th>Proposed by</th><th>Version</th><th>Last run</th><th>When</th><th>Commit</th></tr></thead>
        <tbody>
          ${requirement.testCases
            .map((testCase) => {
              const result = testCase.latestResult
                ? RESULT_WORD[testCase.latestResult] ?? testCase.latestResult.toLowerCase()
                : "never run";
              return `<tr>
                <td>${escape(testCase.title)}${testCase.approvedBy ? `<br><span class="who">approved by ${escape(testCase.approvedBy)}${testCase.approvedAt ? ` on ${stamp(testCase.approvedAt)}` : ""}</span>` : ""}</td>
                <td>${testCase.authoredByAgent ? escape(testCase.authoredByAgent) : "a person"}</td>
                <td class="num">${testCase.versionNumber}</td>
                <td class="${testCase.latestResult === "FAILED" ? "bad" : testCase.latestResult === "PASSED" ? "good" : ""}">${result}</td>
                <td>${testCase.latestExecutedAt ? stamp(testCase.latestExecutedAt) : "&mdash;"}</td>
                <td class="mono">${testCase.latestCommitSha ? escape(testCase.latestCommitSha.slice(0, 8)) : "&mdash;"}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`
    : `<p class="none">No approved test case verifies this requirement.</p>`;

  return `<section class="requirement">
    <div class="head">
      <h3>${escape(requirement.title)}</h3>
      <span class="verdict ${requirement.verdict.toLowerCase()}">${VERDICT_WORD[requirement.verdict]}</span>
    </div>
    <p class="meta">${meta}</p>
    <p class="reason">${escape(requirement.reason)}</p>
    ${tests}
  </section>`;
}

/**
 * One HTML file holding the whole report. `frozen` says whether it came from a
 * snapshot, because that changes what the date at the top means.
 */
export type DocumentSignature = {
  signedName: string;
  signedRole: string | null;
  note: string | null;
  signedAt: Date;
  evidenceHash: string;
};

export function evidenceDocument(
  report: ReleaseEvidenceReport,
  options: { frozen?: boolean; signatures?: readonly DocumentSignature[] } = {},
) {
  const title = `Test evidence — ${report.project.name}`;
  const taken = options.frozen
    ? `Snapshot taken ${stamp(report.generatedAt)}. It shows what was true at that moment.`
    : `Read ${stamp(report.generatedAt)}. It shows the project as it stood at that moment.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 20px 56px; font: 14px/1.6 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; background: #fff; }
  main { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 6px 0 0; letter-spacing: -0.02em; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; margin: 36px 0 12px; }
  h3 { font-size: 15px; margin: 0; }
  .kicker { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: #0e7490; margin: 0; }
  .sub { color: #475569; margin: 6px 0 0; }
  .note { margin: 16px 0 0; padding: 12px 14px; background: #f1f5f9; border-radius: 10px; color: #334155; }
  .totals { display: flex; gap: 12px; margin: 20px 0 0; flex-wrap: wrap; }
  .total { flex: 1 1 160px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; }
  .total span { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #94a3b8; }
  .total strong { display: block; font-size: 26px; margin-top: 4px; font-weight: 600; }
  .requirement { border: 1px solid #e2e8f0; border-radius: 14px; padding: 18px 20px; margin: 0 0 14px; page-break-inside: avoid; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
  .meta { color: #94a3b8; font-size: 12px; margin: 4px 0 0; }
  .reason { color: #475569; margin: 8px 0 0; }
  .verdict { flex: none; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 999px; border: 1px solid; white-space: nowrap; }
  .verdict.verified { color: #166534; background: #f0fdf4; border-color: #bbf7d0; }
  .verdict.failing { color: #b91c1c; background: #fef2f2; border-color: #fecaca; }
  .verdict.unverified { color: #475569; background: #f8fafc; border-color: #e2e8f0; }
  table { width: 100%; border-collapse: collapse; margin: 14px 0 0; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; font-weight: 600; padding: 0 10px 6px 0; }
  td { padding: 7px 10px 7px 0; border-top: 1px solid #f1f5f9; vertical-align: top; }
  td.num, td.mono { font-variant-numeric: tabular-nums; }
  td.mono { font-family: ui-monospace, "SFMono-Regular", Consolas, monospace; font-size: 12px; color: #64748b; }
  td.good { color: #166534; }
  td.bad { color: #b91c1c; font-weight: 600; }
  .none { color: #94a3b8; margin: 12px 0 0; }
  .who { color: #64748b; font-size: 11px; }
  .note.stale { background: #fffbeb; color: #92400e; }
  footer { margin: 36px 0 0; padding: 18px 0 0; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px; }
  @media print {
    body { padding: 0; }
    .requirement { border-color: #cbd5e1; }
  }
</style>
</head>
<body>
<main>
  <p class="kicker">Test evidence</p>
  <h1>${escape(report.project.name)}</h1>
  <p class="sub">${escape(report.organization.name)}</p>
  <p class="note">${taken}</p>

  <div class="totals">
    <div class="total"><span>Verified</span><strong>${report.totals.verified}</strong></div>
    <div class="total"><span>Failing</span><strong>${report.totals.failing}</strong></div>
    <div class="total"><span>Not verified</span><strong>${report.totals.unverified}</strong></div>
  </div>
  ${
    report.totals.stale
      ? `<p class="note stale">${report.totals.stale} of the verified requirement${report.totals.stale === 1 ? " was" : "s were"} last checked more than a month ago. A verdict is only as current as the run behind it.</p>`
      : ""
  }

  <h2>Requirements</h2>
  ${
    report.requirements.length
      ? report.requirements.map(requirementSection).join("")
      : `<p class="none">This project has no approved requirements yet, so there is nothing to verify.</p>`
  }
  ${report.truncated ? `<p class="none">Only the first requirements are shown; the project has more.</p>` : ""}

  ${
    options.signatures?.length
      ? `<h2>Accepted by</h2>
  ${options.signatures
    .map(
      (signature) => `<section class="requirement">
      <div class="head">
        <h3>${escape(signature.signedName)}${signature.signedRole ? ` &middot; ${escape(signature.signedRole)}` : ""}</h3>
        <span class="verdict verified">Accepted</span>
      </div>
      <p class="meta">${stamp(signature.signedAt)} &middot; evidence ${escape(signature.evidenceHash.slice(0, 12))}</p>
      ${signature.note ? `<p class="reason">${escape(signature.note)}</p>` : ""}
    </section>`,
    )
    .join("")}
  <p class="none">Each name above is what that person typed when they accepted the evidence. PlaywrightGen did not
  verify their identity; it recorded that a named person accepted evidence with the reference shown.</p>`
      : ""
  }

  <footer>
    Exported from PlaywrightGen, which keeps each approval and each run as a record that cannot be edited after the
    fact. Every result above was recorded when the test ran, against the approved version it ran. This document
    contains no test code. Where a test was proposed by an assistant, the assistant is named; a person approved every
    one of them either way. playwrightgen.com
  </footer>
</main>
</body>
</html>
`;
}
