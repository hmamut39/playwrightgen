import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GET } from "@/app/ci/[...file]/route";
import { CI_PROVIDERS, CI_TEMPLATES, type CiTemplateName } from "@/lib/ci/templates";
import { ingestPayloadSchema } from "@/lib/services/test-run-ingest";

/**
 * The pipeline files a customer actually receives.
 *
 * The panel used to tell them to copy two files out of `templates/`, a folder
 * that exists only in this repository. Nobody outside it could follow the
 * instruction, and nothing failed to say so, because the instruction was prose.
 * These tests make the promises checkable: the files exist, the paths they name
 * each other by agree, and every provider the reporter can send is one the
 * ingest endpoint accepts.
 */

const read = (name: CiTemplateName) =>
  readFileSync(join(process.cwd(), "templates", CI_TEMPLATES[name].source), "utf8");

const names = Object.keys(CI_TEMPLATES) as CiTemplateName[];

describe("the pipeline files a team downloads", () => {
  it("has a readable file behind every download", () => {
    for (const name of names) {
      expect(read(name).trim().length, `${name} is empty`).toBeGreaterThan(0);
    }
  });

  it("offers each pipeline a definition and the reporter", () => {
    for (const entry of CI_PROVIDERS) {
      expect(entry.files.length, `${entry.name} should offer two files`).toBe(2);
      for (const name of entry.files) {
        expect(names, `${entry.name} offers ${name}, which is not a template`).toContain(name);
      }
    }
  });

  it("agrees with itself about where the reporter goes", () => {
    // Every pipeline definition invokes the reporter by path. If the manifest
    // tells a person to commit it somewhere else, the first run fails with
    // "cannot find module" and the file they were told to download is blamed.
    for (const entry of CI_PROVIDERS) {
      const [definition, reporter] = entry.files;
      const destination = CI_TEMPLATES[reporter].destination;
      expect(read(definition), `${entry.name} never runs ${destination}`).toContain(
        `node ${destination}`,
      );
    }
  });

  it("only claims a provider the ingest endpoint accepts", () => {
    // The reporter decides what to send; the schema decides what is allowed.
    // Drift between them is silent on the runner and fatal at the endpoint.
    const reporter = read("github-actions/playwrightgen-report.mjs");
    const declared = /const PROVIDERS = new Set\((\[[^\]]*\])\)/.exec(reporter);
    expect(declared, "the reporter no longer declares its providers").not.toBeNull();
    const providers = JSON.parse(declared![1].replace(/'/g, '"')) as string[];

    for (const provider of providers) {
      const result = ingestPayloadSchema.shape.run.shape.provider.safeParse(provider);
      expect(result.success, `the reporter may send ${provider}, which ingest rejects`).toBe(true);
    }
  });

  it("tells each pipeline to name itself, and names it something accepted", () => {
    for (const entry of CI_PROVIDERS) {
      const definition = read(entry.files[0]);
      const declared = /PLAYWRIGHTGEN_PROVIDER[ :=]+'?"?([a-z_]+)'?"?/.exec(definition);
      expect(declared, `${entry.name} does not set PLAYWRIGHTGEN_PROVIDER`).not.toBeNull();
      expect(
        ingestPayloadSchema.shape.run.shape.provider.safeParse(declared![1]).success,
        `${entry.name} reports as ${declared?.[1]}, which ingest rejects`,
      ).toBe(true);
    }
  });

  it("gives the test run a way to be told the application's address", () => {
    // A test PlaywrightGen writes opens './', relative to Playwright's
    // baseURL. The pipeline it hands a team passed nothing to the test run,
    // so a configuration reading the address from the environment got
    // nothing, and the dogfood repository reported a skip for weeks with no
    // page, log or comment saying why.
    const workflow = read("github-actions/playwrightgen.yml");
    const testStep = workflow.slice(workflow.indexOf("name: Run Playwright"));
    expect(testStep).toContain("BASE_URL: ${{ vars.BASE_URL }}");
    expect(testStep).toContain("relative to Playwright's baseURL");
    // Said where it is read: the other two pipelines already pass their
    // whole environment through, so they are told, not changed.
    for (const file of ["gitlab-ci/playwrightgen.gitlab-ci.yml", "jenkins/Jenkinsfile.playwrightgen"] as CiTemplateName[]) {
      expect(read(file)).toContain("relative to");
    }
  });

  it("documents the token as a secret in every pipeline, and never its value", () => {
    for (const name of names) {
      const body = read(name);
      expect(body).toContain("PLAYWRIGHTGEN_TOKEN");
      // A template is downloaded by anyone with the URL, so it must carry the
      // names of credentials and none of their values.
      expect(body).not.toMatch(/pwg(p|b)1\./);
    }
  });
});

describe("serving them", () => {
  const request = new Request("https://example.test/ci/x");

  it("serves a file named for where it lands", async () => {
    const response = await GET(request, {
      params: Promise.resolve({ file: ["github-actions", "playwrightgen.yml"] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain('filename="playwrightgen.yml"');
    expect(await response.text()).toContain("name: PlaywrightGen");
  });

  it("serves the one reporter at each pipeline's own path", async () => {
    const gitlab = await GET(request, {
      params: Promise.resolve({ file: ["gitlab-ci", "playwrightgen-report.mjs"] }),
    });
    const github = await GET(request, {
      params: Promise.resolve({ file: ["github-actions", "playwrightgen-report.mjs"] }),
    });

    expect(gitlab.status).toBe(200);
    // One file, so a fix to the reporter reaches every pipeline at once.
    expect(await gitlab.text()).toBe(await github.text());
  });

  it("serves nothing it was not asked to offer", async () => {
    for (const file of [
      ["github-actions", ".."],
      ["..", "..", ".env"],
      ["github-actions", "playwrightgen.yaml"],
      ["nothing"],
    ]) {
      const response = await GET(request, { params: Promise.resolve({ file }) });
      expect(response.status, `${file.join("/")} was served`).toBe(404);
    }
  });
});
