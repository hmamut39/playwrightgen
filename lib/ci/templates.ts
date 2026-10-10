/**
 * The pipeline files a team commits into their own repository, described once.
 *
 * Plain data with no filesystem in it, because both sides need it: the route
 * that serves a file reads this to find it, and the setup panel -- a client
 * component -- reads it to list what to download and where each file goes.
 * Reading the files themselves is in `lib/services/ci-templates`.
 */

export type CiProvider = "github-actions" | "gitlab-ci" | "jenkins";

export type CiTemplate = {
  /** Path under `templates/`. Two entries may share one source file. */
  source: string;
  /** Where it goes in their repository. */
  destination: string;
  contentType: string;
  /** What it is, in one line, for the panel. */
  summary: string;
};

/** The shared reporter. One file, three pipelines, one payload shape. */
const REPORTER = "github-actions/playwrightgen-report.mjs";
const REPORTER_TYPE = "text/javascript; charset=utf-8";
const REPORTER_SUMMARY =
  "Signs and sends the bounded summary. No repository contents leave your runner.";

/**
 * Keyed by download path, not by source path, so the same reporter can be
 * offered at the place each pipeline expects to find it.
 */
export const CI_TEMPLATES = {
  "github-actions/playwrightgen.yml": {
    source: "github-actions/playwrightgen.yml",
    destination: ".github/workflows/playwrightgen.yml",
    contentType: "text/yaml; charset=utf-8",
    summary: "Runs your Playwright tests on your own runners and reports the result back.",
  },
  "github-actions/playwrightgen-report.mjs": {
    source: REPORTER,
    destination: ".github/workflows/playwrightgen-report.mjs",
    contentType: REPORTER_TYPE,
    summary: REPORTER_SUMMARY,
  },
  "gitlab-ci/playwrightgen.gitlab-ci.yml": {
    source: "gitlab-ci/playwrightgen.gitlab-ci.yml",
    destination: "ci/playwrightgen.gitlab-ci.yml",
    contentType: "text/yaml; charset=utf-8",
    summary: "A test job for your pipeline, or a whole .gitlab-ci.yml if you have none.",
  },
  "gitlab-ci/playwrightgen-report.mjs": {
    source: REPORTER,
    destination: "ci/playwrightgen-report.mjs",
    contentType: REPORTER_TYPE,
    summary: REPORTER_SUMMARY,
  },
  "jenkins/Jenkinsfile.playwrightgen": {
    source: "jenkins/Jenkinsfile.playwrightgen",
    destination: "Jenkinsfile",
    contentType: "text/plain; charset=utf-8",
    summary: "A declarative pipeline, or three stages to paste into the one you have.",
  },
  "jenkins/playwrightgen-report.mjs": {
    source: REPORTER,
    destination: "ci/playwrightgen-report.mjs",
    contentType: REPORTER_TYPE,
    summary: REPORTER_SUMMARY,
  },
} as const satisfies Record<string, CiTemplate>;

export type CiTemplateName = keyof typeof CI_TEMPLATES;

/**
 * What the panel shows, one block per pipeline.
 *
 * `where` and `secretLabel` differ because the three systems do not
 * agree on what a secret is called or where it is set, and an instruction that
 * names the wrong screen is the kind that quietly wastes an afternoon.
 */
export const CI_PROVIDERS = [
  {
    id: "github-actions",
    name: "GitHub Actions",
    files: ["github-actions/playwrightgen.yml", "github-actions/playwrightgen-report.mjs"],
    where: "Repository · Settings · Secrets and variables · Actions",
    secretLabel: "add PLAYWRIGHTGEN_TOKEN as a secret, and the other three as variables.",
  },
  {
    id: "gitlab-ci",
    name: "GitLab CI",
    files: ["gitlab-ci/playwrightgen.gitlab-ci.yml", "gitlab-ci/playwrightgen-report.mjs"],
    where: "Project · Settings · CI/CD · Variables",
    secretLabel: "add all four as variables. Mark PLAYWRIGHTGEN_TOKEN as Masked.",
  },
  {
    id: "jenkins",
    name: "Jenkins",
    files: ["jenkins/Jenkinsfile.playwrightgen", "jenkins/playwrightgen-report.mjs"],
    where: "Manage Jenkins · Credentials",
    secretLabel:
      "add PLAYWRIGHTGEN_TOKEN as a Secret text credential with the id playwrightgen-token. The other three are filled into the Jenkinsfile.",
  },
] as const satisfies ReadonlyArray<{
  id: CiProvider;
  name: string;
  files: ReadonlyArray<CiTemplateName>;
  where: string;
  secretLabel: string;
}>;

export function isCiTemplate(name: string): name is CiTemplateName {
  return Object.hasOwn(CI_TEMPLATES, name);
}
