import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";
import { SECURITY_HEADER_RULES } from "@/lib/security/response-headers";
import { isPublicWebAddress } from "@/lib/free-tools/public-address";
import {
  OWASP_CHECKED_ON,
  OWASP_EDITION,
  OWASP_POSTURE,
  OWASP_POSTURE_LIMITS,
  type PostureItem,
} from "@/lib/security/owasp-posture";

/**
 * The security page's claims, checked against the code that is supposed to
 * make them true.
 *
 * A security page is the easiest page in a product to write dishonestly:
 * every line is a claim about code the reader cannot see, written by the
 * person who benefits from it, and nobody ever checks. So the claims that can
 * be checked are checked here, and they fail when the code stops matching --
 * which is the only way a claim does not quietly outlive its implementation.
 * The sending address went wrong in exactly that way: three files stated it,
 * one setting moved one of them, and nothing noticed for weeks.
 */
const item = (id: string): PostureItem => {
  const found = OWASP_POSTURE.find((entry) => entry.id === id);
  if (!found) throw new Error(`no posture item for ${id}`);
  return found;
};

/** Every TypeScript file in the directories that hold this product's code. */
function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(root, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe("the shape of the posture", () => {
  it("covers the current list once each, in order", () => {
    // A missing category reads as "not a problem here", which is a claim
    // nobody made on purpose.
    expect(OWASP_POSTURE.map((entry) => entry.id)).toEqual([
      "A01:2025",
      "A02:2025",
      "A03:2025",
      "A04:2025",
      "A05:2025",
      "A06:2025",
      "A07:2025",
      "A08:2025",
      "A09:2025",
      "A10:2025",
    ]);
    expect(OWASP_EDITION).toBe("OWASP Top 10:2025");
  });

  it("dates the list it was read from", () => {
    // The eleventh edition will arrive without telling this repository.
    expect(OWASP_CHECKED_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("says something real for every category, and never an empty gap", () => {
    for (const entry of OWASP_POSTURE) {
      expect(entry.title.length, entry.id).toBeGreaterThan(3);
      expect(entry.inPlace.length, entry.id).toBeGreaterThan(0);
      for (const line of entry.inPlace) expect(line.length, entry.id).toBeGreaterThan(40);
      // null means "nothing to add". An empty string is a gap somebody began
      // writing and left looking like an absence of one.
      if (entry.gap !== null) expect(entry.gap.trim().length, entry.id).toBeGreaterThan(20);
    }
  });

  it("does not let the ten paragraphs read as an audit", () => {
    expect(OWASP_POSTURE_LIMITS).toContain("no external penetration test");
    expect(OWASP_POSTURE_LIMITS).toContain("no bug bounty");
  });

  it("admits at least one thing that is missing", () => {
    /*
     * The guard against this page drifting into marketing. Ten categories
     * with nothing missing would not be a posture, it would be a brochure,
     * and a reader who spots one hollow claim rightly discards the other
     * nine.
     */
    expect(OWASP_POSTURE.filter((entry) => entry.gap !== null).length).toBeGreaterThan(2);
  });
});

describe("A01: the addresses this product refuses to open", () => {
  it("refuses the cloud metadata address, which is the one that matters", () => {
    // The claim on the page is that link-local is refused. This is why: on a
    // cloud host, 169.254.169.254 hands out credentials to whoever asks.
    expect(isPublicWebAddress("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("refuses every range the page says it refuses", () => {
    for (const address of [
      "http://localhost:3000/",
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://172.16.4.4/",
      "http://192.168.1.1/",
      "http://100.64.0.1/",
      "http://[::1]/",
      "http://[fd00::1]/",
      "http://admin:secret@example.com/",
      "file:///etc/passwd",
      "http://intranet.internal/",
      "http://wiki.local/",
    ]) {
      expect(isPublicWebAddress(address), `let through ${address}`).toBe(false);
    }
  });

  it("still opens an ordinary public page", () => {
    // A guard that refuses everything would be safe and useless.
    expect(isPublicWebAddress("https://example.com/login")).toBe(true);
  });

  it("names request forgery, because the 2025 list moved it here", () => {
    expect(item("A01:2025").inPlace.join(" ")).toContain("request forgery");
  });
});

describe("A02: the headers the page says are sent", () => {
  it("declares each one in the build configuration", async () => {
    /*
     * The claim and the configuration cannot drift apart. Removing a header
     * from next.config.ts fails this test rather than quietly making a
     * sentence on /about untrue.
     */
    const rules = await nextConfig.headers!();
    const sent = rules.flatMap((rule) => rule.headers.map((header) => header.key));

    expect(sent).toContain("X-Content-Type-Options");
    expect(sent).toContain("Referrer-Policy");
    expect(sent).toContain("X-Frame-Options");
    expect(sent).toContain("Permissions-Policy");
  });

  it("applies them to every path, not only to one", () => {
    // A header on /about and nowhere else would be the worst outcome: the
    // claim would be verifiable by hand on the page making it.
    expect(nextConfig.headers).toBeTypeOf("function");
  });

  it("covers every path but the framework's own, and still guards built assets", async () => {
    const rules = await nextConfig.headers!();

    expect(rules.map((rule) => rule.source)).toEqual(["/((?!_next/).*)", "/_next/static/:path*"]);
    // A script served as the wrong type is where nosniff matters most.
    expect(rules[1].headers).toEqual([{ key: "X-Content-Type-Options", value: "nosniff" }]);
  });

  it("reads its list from the one place the posture reads it from", () => {
    // Two copies of a security claim is how the sending address came to be
    // written in three files and changed in one.
    expect(SECURITY_HEADER_RULES[0].headers.map((header) => header.key)).toContain(
      "X-Frame-Options",
    );
  });

  it("says out loud that there is no content security policy", async () => {
    const rules = await nextConfig.headers!();
    const sent = rules.flatMap((rule) => rule.headers.map((header) => header.key));

    // If a CSP is ever added, this fails -- and the sentence on /about saying
    // there is none has to be rewritten, which is the point.
    expect(sent).not.toContain("Content-Security-Policy");
    expect(item("A02:2025").gap).toContain("no Content-Security-Policy");
  });
});

describe("A03: the audit gates the page says run", () => {
  const workflows = readdirSync(".github/workflows")
    .map((name) => readFileSync(join(".github/workflows", name), "utf8"))
    .join("\n");

  it("audits what ships and the tooling, at high severity", () => {
    expect(workflows).toContain("npm audit --omit=dev --audit-level=high");
    expect(workflows).toContain("npm audit --audit-level=high");
  });
});

describe("A04: the evidence signing the page says happens", () => {
  it("signs a run receipt and compares it in constant time", () => {
    const receipt = readFileSync("lib/free-tools/preview-run/receipt.ts", "utf8");

    expect(receipt).toContain("createHmac");
    expect(receipt).toContain("sha256");
    // A string comparison here leaks the signature one byte at a time.
    expect(receipt).toContain("timingSafeEqual");
  });
});

describe("A05: the raw query escapes the page says are unused", () => {
  it("finds none of them anywhere in the product's own code", () => {
    /*
     * `$queryRaw` with a tagged template is parameterised and safe. The
     * `Unsafe` variants take a string the caller built, which is the only way
     * SQL injection reaches a Prisma application, and the page claims they
     * appear nowhere. This is that claim.
     */
    const offenders = [...sourceFiles("lib"), ...sourceFiles("app")].filter((path) => {
      const text = readFileSync(path, "utf8");
      return text.includes("$queryRawUnsafe") || text.includes("$executeRawUnsafe");
    });

    expect(offenders, "a raw query built from a string").toEqual([]);
  });
});

describe("A05: the prompt injection the page says is measured", () => {
  it("has an eval that feeds the model a page giving it orders", () => {
    const evalFile = readFileSync("evals/prompt-injection.eval.ts", "utf8");

    expect(evalFile).toContain("SYSTEM INSTRUCTION FOR AI AGENTS");
    // The honest half of the claim: it is a measurement, not a guarantee.
    expect(item("A05:2025").gap).toContain("measurement");
  });
});

describe("A08: the migrations the page says are versioned", () => {
  it("keeps migrations in the repository and never pushes a schema", () => {
    const migrations = readdirSync("prisma/migrations").filter((name) =>
      statSync(join("prisma/migrations", name)).isDirectory(),
    );
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;

    expect(migrations.length).toBeGreaterThan(0);
    // `prisma db push` changes a schema with no migration to review or replay.
    for (const [name, command] of Object.entries(scripts)) {
      expect(command, `${name} pushes a schema`).not.toContain("db push");
    }
  });
});
