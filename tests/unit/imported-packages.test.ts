import { describe, expect, it } from "vitest";

import { importedPackages, validateAutomationGeneration } from "@/lib/ai/automation-generation";

/**
 * What a generated artifact imports, as opposed to what it says it imports.
 *
 * The rule that allows only @playwright/test read `output.dependencies`, a
 * field the model fills in itself. So it trusted a self-report -- code
 * importing axios while declaring only @playwright/test passed the check that
 * exists to stop that -- and it blocked on the declaration alone, failing
 * artifacts whose code was clean because the model had over-listed in a field
 * nobody runs.
 *
 * The second fault is how the eval came to flake. Across four runs the same
 * case reported nothing, two warnings, nothing, then BLOCKED on
 * unsupported_dependency, with the input unchanged.
 */
const artifact = (code: string, dependencies: string[] = ["@playwright/test"]) => ({
  name: "A visitor adds a todo",
  summary: "Adds a todo and checks the list.",
  plan: [
    {
      title: "Adds a todo",
      intent: "A typed todo appears in the list.",
      expectedAssertion: "The list shows Buy milk.",
    },
  ],
  code,
  configuration:
    "import { defineConfig } from '@playwright/test';\nexport default defineConfig({ use: { baseURL: 'https://demo.playwright.dev/todomvc/' } });",
  dependencies,
  assumptions: [] as string[],
});

const clean = [
  "import { test, expect } from '@playwright/test';",
  "test('adds a todo', async ({ page }) => {",
  "  await page.goto('./');",
  "  await expect(page.getByText('Buy milk')).toBeVisible();",
  "});",
].join("\n");

const codesOf = (output: Parameters<typeof validateAutomationGeneration>[1]) =>
  validateAutomationGeneration("PLAYWRIGHT_BROWSER", output).findings.map((finding) => finding.code);

describe("the packages a generated artifact imports", () => {
  it("reads every spelling that reaches a module", () => {
    const code = [
      "import { test } from '@playwright/test';",
      "import axios from 'axios';",
      "import 'side-effect-package';",
      "const dotenv = require('dotenv');",
      "const lazy = await import('got');",
    ].join("\n");

    expect(importedPackages(code).sort()).toEqual(
      ["@playwright/test", "axios", "dotenv", "got", "side-effect-package"].sort(),
    );
  });

  it("does not count relative files or node builtins as packages", () => {
    // A relative path is not something to install, and node: builtins are
    // judged by the safety rules, which is where that decision belongs.
    const code = [
      "import { helper } from './helpers';",
      "import { other } from '../shared/other';",
      "import { randomUUID } from 'node:crypto';",
    ].join("\n");

    expect(importedPackages(code)).toEqual([]);
  });

  it("attributes a deep import to the package it comes from", () => {
    expect(importedPackages("import { chromium } from 'playwright-core/lib/server';")).toEqual([
      "playwright-core",
    ]);
    expect(importedPackages("import { test } from '@playwright/test/reporter';")).toEqual([
      "@playwright/test",
    ]);
  });
});

describe("what the dependency rule blocks", () => {
  it("blocks code that imports a package, whatever it declared", () => {
    // The hole: the declaration said the right thing and the code did not.
    const codes = codesOf(
      artifact(`import axios from 'axios';\n${clean}`, ["@playwright/test"]),
    );

    expect(codes).toContain("unsupported_dependency");
  });

  it("does not block an artifact whose code is clean but whose list is wrong", () => {
    // The flake: a runnable artifact failing review over a field nobody runs.
    const result = validateAutomationGeneration(
      "PLAYWRIGHT_BROWSER",
      artifact(clean, ["@playwright/test", "dotenv"]),
    );
    const blocking = result.findings.filter((finding) => finding.severity === "BLOCKING");

    expect(blocking).toEqual([]);
    // Said, though: the list is still wrong and that is worth knowing.
    expect(result.findings.map((finding) => finding.code)).toContain("declared_dependency_unused");
  });

  it("says nothing about dependencies when the code and the list agree", () => {
    const codes = codesOf(artifact(clean, ["@playwright/test"]));

    expect(codes).not.toContain("unsupported_dependency");
    expect(codes).not.toContain("declared_dependency_unused");
  });

  it("still allows an artifact that declares nothing at all", () => {
    const codes = codesOf(artifact(clean, []));

    expect(codes).not.toContain("unsupported_dependency");
    expect(codes).not.toContain("declared_dependency_unused");
  });
});
