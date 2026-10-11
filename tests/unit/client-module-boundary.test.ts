import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A rule the framework does not enforce and will not warn about.
 *
 * When a server component imports from a `"use client"` module, the bundler
 * replaces every export with a client reference. For a component that is the
 * point. For a plain value it is a trap: the server sees an object with none
 * of the fields it had. `initialGapsState` was imported this way into a
 * requirement page and spread into a server action's answer, so the answer
 * arrived with no `criteria`, and the panel took the whole requirement page
 * down with "Cannot read properties of undefined (reading 'filter')" --
 * every time it had something to report, including the commonest case of
 * all: no approved test linked yet.
 *
 * Nothing in typecheck, lint or a build says a word about it. This does.
 */
const root = resolve(__dirname, "..", "..");
const DIRECTORIES = ["app", "components", "lib", "hooks"];
const SOURCE = /\.(ts|tsx)$/;

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
    return SOURCE.test(entry) && !entry.endsWith(".d.ts") ? [relative] : [];
  });
}

const IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;

/** A module that runs in the browser: the directive is its first statement. */
const isClientModule = (source: string) => /^\s*(\/\*[\s\S]*?\*\/\s*)?["']use client["']/.test(source);

/** Where an import specifier points, as a key of the given sources, or null. */
function resolveSpecifier(sources: Map<string, string>, fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? specifier.slice(2)
    : specifier.startsWith(".")
      ? join(fromFile, "..", specifier).split(/[\/]/).join("/")
      : null;
  if (!base) return null;
  const candidates = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base];
  return candidates.find((candidate) => sources.has(candidate)) ?? null;
}

/**
 * Every plain value a server module takes from a client module. Components
 * are why client modules exist and types vanish at compile time; a hook or a
 * constant crossing this way is the bug.
 */
export function valuesTakenFromClientModules(sources: Map<string, string>): string[] {
  const clientModules = new Set([...sources].filter(([, source]) => isClientModule(source)).map(([file]) => file));
  const offences: string[] = [];
  for (const [file, source] of sources) {
    if (clientModules.has(file)) continue;
    for (const match of source.matchAll(IMPORT)) {
      const [, typeOnly, names, specifier] = match;
      if (typeOnly) continue;
      const target = resolveSpecifier(sources, file, specifier);
      if (!target || !clientModules.has(target)) continue;
      for (const entry of names.split(",")) {
        const name = entry.trim();
        if (!name || name.startsWith("type ")) continue;
        const local = (name.split(/\s+as\s+/).pop() ?? name).trim();
        if (/^[A-Z]/.test(local)) continue;
        offences.push(`${file} imports ${local} from ${specifier} ("use client")`);
      }
    }
  }
  return offences;
}

const files = DIRECTORIES.flatMap(sourceFiles);
const contents = new Map(files.map((file) => [file, readFileSync(join(root, file), "utf8")]));

describe("what a server module may take from a client module", () => {
  it("catches the import that took the requirement page down", () => {
    // The shape of the bug, written out: the page spread this value into a
    // server action's answer and the answer arrived with none of its fields.
    const offences = valuesTakenFromClientModules(
      new Map([
        [
          "components/workspace/panel.tsx",
          ['"use client";', "export const initialState = { criteria: [] };", "export function Panel() {}"].join("\n"),
        ],
        [
          "app/requirements/page.tsx",
          'import { Panel, initialState, type PanelState } from "@/components/workspace/panel";',
        ],
      ]),
    );
    expect(offences).toEqual([
      'app/requirements/page.tsx imports initialState from @/components/workspace/panel ("use client")',
    ]);
  });

  it("allows what client modules are for", () => {
    const offences = valuesTakenFromClientModules(
      new Map([
        [
          "components/panel.tsx",
          ['"use client";', "export function Panel() {}", "export type PanelState = { a: 1 };"].join("\n"),
        ],
        ["components/plain.ts", "export const initialState = { criteria: [] };"],
        [
          "app/page.tsx",
          [
            'import { Panel } from "@/components/panel";',
            'import type { PanelState } from "@/components/panel";',
            'import { initialState } from "@/components/plain";',
          ].join("\n"),
        ],
      ]),
    );
    expect(offences).toEqual([]);
  });

  it("holds for this repository", () => {
    expect(valuesTakenFromClientModules(contents)).toEqual([]);
    // A rule that matches nothing proves nothing.
    expect([...contents].filter(([, source]) => isClientModule(source)).length).toBeGreaterThan(5);
  });
});
