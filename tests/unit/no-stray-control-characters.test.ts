import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * No source file may contain a raw control character.
 *
 * Written after the same accident three times in one day, twice in a rule
 * meant to stop something dangerous. A tool wrote `\b` into a regular
 * expression as the byte it escapes -- 0x08, backspace -- so the pattern
 * became `/^H(?:delete|destroy)/` and could never match anything. The guard
 * was in the file, its tests existed, and it stopped nothing.
 *
 * That is the worst way for a rule to be wrong: present, readable, and
 * silently inert. Typecheck says nothing, lint says nothing, and a reader
 * sees `\b` because their editor renders the byte as an escape. The only
 * thing that catches it is looking at the bytes.
 */
const root = resolve(__dirname, "..", "..");
const DIRECTORIES = ["app", "components", "lib", "scripts", "tests", "evals", "hooks"];
const SOURCE = /\.(ts|tsx|mjs|js|jsx)$/;
/** Everything below space except tab, newline and carriage return, plus DEL. */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function sourceFiles(directory: string): string[] {
  const here = join(root, directory);
  let entries: string[];
  try {
    entries = readdirSync(here);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(here, entry);
    const relative = `${directory}/${entry}`;
    if (statSync(path).isDirectory()) return sourceFiles(relative);
    return SOURCE.test(entry) ? [relative] : [];
  });
}

describe("what is actually in the files", () => {
  it("contains no raw control character anywhere", () => {
    const offences: string[] = [];
    for (const file of DIRECTORIES.flatMap(sourceFiles)) {
      const lines = readFileSync(join(root, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        const match = CONTROL.exec(line);
        if (!match) return;
        const code = `0x${match[0].charCodeAt(0).toString(16).padStart(2, "0")}`;
        offences.push(`${file}:${index + 1} contains ${code} — an escape was written as the byte it stands for`);
      });
    }

    expect(offences).toEqual([]);
  });

  it("would notice the byte that started this", () => {
    // Proves the check can fail: a rule that matches nothing is exactly what
    // it is here to catch.
    expect(CONTROL.test("const RULE = /\u0008(?:delete)/i;")).toBe(true);
    expect(CONTROL.test("const RULE = /\\b(?:delete)/i;")).toBe(false);
    // Ordinary code, including the whitespace a file is made of.
    expect(CONTROL.test("const name = 'x';\t// fine")).toBe(false);
  });
});
