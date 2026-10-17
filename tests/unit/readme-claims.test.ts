import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { GITHUB_PERMISSION_CEILING } from "@/lib/integrations/github/app-client";

/**
 * The two claims in the README that a reader cannot check for themselves.
 *
 * A stale README is usually only embarrassing. These two are different: they
 * are the answers to "how much of my repository does this product get" and
 * "what can an agent do with my project", and somebody deciding whether to
 * install anything reads them instead of the code.
 *
 * Both were wrong before 2026-10-17. The README said the GitHub App is
 * "read-only during repository import" long after it gained contents write
 * (to open a pull request with approved test code) and pull-requests write
 * (to leave the evidence note on it). A security claim that is generous to
 * us is the one kind of staleness that is not harmless.
 */
const root = resolve(__dirname, "..", "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const server = readFileSync(join(root, "lib", "mcp", "playwrightgen-mcp.ts"), "utf8");

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen", "twenty", "twenty-one", "twenty-two", "twenty-three", "twenty-four", "twenty-five",
];

describe("what the README promises about access", () => {
  it("counts the MCP tools the server really has", () => {
    // Tool definitions are one object each, indented inside the array.
    const tools = (server.match(/^ {4}name: "[a-z_]+",$/gm) ?? []).length;
    expect(tools).toBeGreaterThan(5);
    const word = NUMBER_WORDS[tools];
    expect(word, `no word for ${tools} tools; extend the list`).toBeDefined();
    expect(readme, `the README does not say there are ${word} MCP tools`).toContain(`${word} tools`);
  });

  it("describes the GitHub App's permissions as the code enforces them", () => {
    const sentence = readme.slice(readme.indexOf("permission ceiling"), readme.indexOf("permission ceiling") + 600);
    expect(sentence, "the README no longer describes the ceiling").toContain("metadata");

    for (const [permission, levels] of Object.entries(GITHUB_PERMISSION_CEILING)) {
      expect(sentence, `the README does not mention ${permission}`).toContain(permission);
      for (const level of levels) {
        expect(sentence, `the README does not say ${permission} may be ${level}`).toContain(level);
      }
    }
    // Anything the ceiling does not grant must not be described as granted,
    // and the claim it used to make must not come back.
    for (const absent of ["administration", "workflows", "packages", "secrets", "members"]) {
      expect(sentence, `the README claims ${absent}`).not.toContain(absent);
    }
    expect(readme).not.toMatch(/App is read-only/);
  });
});
