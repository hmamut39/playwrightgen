import { readFileSync } from "node:fs";
import { join, posix, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The MCP server tells every agent that connects:
 *
 *   "You can propose and send code, but not approve: a person reviews
 *    everything in PlaywrightGen before it counts."
 *
 * That sentence is the product. An editor assistant can already write
 * Playwright; what it cannot do on its own is say which behaviour was agreed
 * and by whom, and the answer is only worth anything while the agent cannot
 * also be the one who agreed it.
 *
 * Today the sentence is true for a reason nothing records: there is no approve
 * tool, no accept tool, no share or delete tool. The boundary is held by
 * absence. Absence is the one thing a code review of a diff that *adds* a tool
 * will not notice -- the new tool reads fine on its own, and the promise it
 * breaks is in a string 900 lines above it.
 *
 * So the boundary is written down here instead: no module reachable from the
 * MCP server may import a capability that approves, accepts, shares or
 * deletes. A tool that crosses the line has to import something to do it, and
 * then this test names the import and the file it came from.
 *
 * It is a static read of the import graph, which is why it lives in the unit
 * suite and needs no database. The integration suite already pins the list of
 * tools and which of them write; this pins what the writing ones can reach.
 */
const root = resolve(__dirname, "..", "..");
const ENTRY = "lib/mcp/playwrightgen-mcp.ts";

/** Named imports, so the type-only ones can be told apart and skipped. */
const NAMED_IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
/** Every edge in the graph, including default, namespace and re-export forms. */
const ANY_EDGE = /from\s*["']([^"']+)["']/g;
/** `import * as services from "..."`: a name the rule below cannot see through. */
const NAMESPACE_IMPORT = /import\s+\*\s+as\s+(\w+)\s+from\s*["']([^"']+)["']/g;

/**
 * Capabilities an agent must not reach: deciding something, or taking
 * something away. Named by shape rather than by a list, so a capability
 * written next month is covered the day it is written.
 *
 * The verb has to be followed by a capital, which is what separates doing the
 * thing from describing it: `approveTestCase` acts, `approvalPolicy` and
 * `checkSelfApproval` and `rejectionNote` only have an opinion. The three
 * exact names are capabilities whose verb is innocent on its own.
 */
const DENIED = [
  /^(?:approve|accept|reject|publish|revoke|archive|delete|remove|assign|rotate|cancel|grant|transfer)[A-Z]/,
  /^(?:signEvidence|createProofLink|changeProjectMemberRole)$/,
];

const isDenied = (name: string) => DENIED.some((pattern) => pattern.test(name));

/** Where an import specifier points, as a repository path, or null for a package. */
function resolveSpecifier(read: Read, fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? specifier.slice(2)
    : specifier.startsWith(".")
      ? posix.join(posix.dirname(fromFile), specifier)
      : null;
  if (!base) return null;
  const candidates = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`, base];
  return candidates.find((candidate) => read(candidate) !== null) ?? null;
}

type Read = (file: string) => string | null;

/** The imported names in one `{ a, b as c }` clause, as they are used locally. */
function importedNames(clause: string): string[] {
  return clause
    .split(",")
    .map((entry) => (entry.split(/\s+as\s+/).pop() ?? "").trim().replace(/^type\s+/, ""))
    .filter((name) => name.length > 0);
}

/**
 * Walks every module an entry point can reach and reports each denied
 * capability it takes in. `visited` is returned too: a rule that quietly
 * stopped walking would otherwise report a clean boundary.
 */
export function reachableCapabilities(read: Read, entry: string): { visited: string[]; offences: string[] } {
  const seen = new Set([entry]);
  const queue = [entry];
  const offences: string[] = [];

  while (queue.length > 0) {
    const file = queue.shift() as string;
    const source = read(file);
    if (source === null) continue;
    // Generated client code is machine-written and imports nothing of ours.
    if (file.startsWith("generated/")) continue;

    for (const match of source.matchAll(ANY_EDGE)) {
      const target = resolveSpecifier(read, file, match[1]);
      if (target !== null && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }

    for (const match of source.matchAll(NAMED_IMPORT)) {
      const [, typeOnly, clause, specifier] = match;
      if (typeOnly) continue;
      const target = resolveSpecifier(read, file, specifier);
      if (target === null) continue;
      for (const name of importedNames(clause)) {
        if (isDenied(name)) offences.push(`${file} imports ${name} from ${target}`);
      }
    }

    for (const match of source.matchAll(NAMESPACE_IMPORT)) {
      const target = resolveSpecifier(read, file, match[2]);
      if (target === null) continue;
      // Every name at once, under one local alias. What it reaches cannot be
      // read off the import, so the boundary cannot be checked at all.
      offences.push(`${file} imports all of ${target} as ${match[1]}`);
    }
  }

  return { visited: [...seen].sort(), offences };
}

const fromDisk: Read = (file) => {
  try {
    return readFileSync(join(root, file), "utf8");
  } catch {
    return null;
  }
};

const fromMap = (sources: Map<string, string>): Read => (file) => sources.get(file) ?? null;

describe("what an agent can reach through the MCP server", () => {
  it("catches an approval taken in two modules deep", () => {
    const { offences } = reachableCapabilities(
      fromMap(
        new Map([
          ["lib/mcp/server.ts", 'import { runTool } from "@/lib/mcp/tools";'],
          ["lib/mcp/tools.ts", 'import { approveTestCase } from "@/lib/services/test-cases";'],
          ["lib/services/test-cases.ts", "export function approveTestCase() {}"],
        ]),
      ),
      "lib/mcp/server.ts",
    );
    expect(offences).toEqual(["lib/mcp/tools.ts imports approveTestCase from lib/services/test-cases.ts"]);
  });

  it("allows proposing, submitting for review, and the guard that separates duties", () => {
    const { offences } = reachableCapabilities(
      fromMap(
        new Map([
          [
            "lib/mcp/server.ts",
            [
              'import { createTestCase, submitTestCaseForReview } from "@/lib/services/test-cases";',
              'import { checkSelfApproval } from "@/lib/services/approval-policy";',
              'import type { approveTestCase } from "@/lib/services/test-cases";',
              'import { rejectionNote } from "./notes";',
            ].join("\n"),
          ],
          ["lib/services/test-cases.ts", "export function createTestCase() {}"],
          ["lib/services/approval-policy.ts", "export function checkSelfApproval() {}"],
          ["lib/mcp/notes.ts", "export const rejectionNote = () => null;"],
        ]),
      ),
      "lib/mcp/server.ts",
    );
    expect(offences).toEqual([]);
  });

  it("refuses an import it cannot read the names of", () => {
    const { offences } = reachableCapabilities(
      fromMap(
        new Map([
          ["lib/mcp/server.ts", 'import * as cases from "@/lib/services/test-cases";'],
          ["lib/services/test-cases.ts", "export function approveTestCase() {}"],
        ]),
      ),
      "lib/mcp/server.ts",
    );
    expect(offences).toEqual(["lib/mcp/server.ts imports all of lib/services/test-cases.ts as cases"]);
  });

  it("holds for the server this product ships", () => {
    const { visited, offences } = reachableCapabilities(fromDisk, ENTRY);

    expect(offences).toEqual([]);
    // The walk reached the modules where approving actually lives, so the
    // clean result above is a boundary and not a short walk: these three hold
    // approveRequirement, approveTestCase and approveAutomationArtifact, and
    // the server imports the drafting functions beside them without ever
    // importing those.
    expect(visited).toContain("lib/services/requirements.ts");
    expect(visited).toContain("lib/services/test-cases.ts");
    expect(visited).toContain("lib/services/automation-artifacts.ts");
    expect(visited.filter((file) => file.startsWith("lib/")).length).toBeGreaterThan(30);
  });

  it("finds the capability where a person does have it", () => {
    // The same rule, pointed at the page where a reviewer approves a test
    // case. If this came back clean the rule above would be measuring
    // nothing, and this is the one place in the repository that proves it is
    // not: real file, real import, real capability.
    const reviews = "app/workspace/[orgSlug]/projects/[projectId]/reviews/page.tsx";
    expect(fromDisk(reviews), `${reviews} has moved -- point this at the page that approves`).not.toBeNull();

    const { offences } = reachableCapabilities(fromDisk, reviews);
    expect(offences).toContain(`${reviews} imports approveTestCase from lib/services/test-cases.ts`);
  });

  it("goes through the services, so through the same authorization as the web app", () => {
    const source = fromDisk(ENTRY) as string;
    // A tool holding the database client directly would answer to nothing:
    // every scope, every tenant check and the approval rules themselves live
    // in the services it would be stepping around.
    expect(source, "the MCP server reaches the database without a service in between").not.toMatch(
      /from\s*["']@\/lib\/db\/prisma["']/,
    );
  });

  it("still tells the agent that a person decides", () => {
    // The promise and the absence of capability are one thing. Losing the
    // sentence leaves agents guessing at a boundary they cannot see.
    expect(fromDisk(ENTRY)).toMatch(/propose and send code, but not approve/);
  });
});
