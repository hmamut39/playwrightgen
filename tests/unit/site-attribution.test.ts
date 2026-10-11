import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SITE_AUTHOR, SITE_PURPOSE } from "@/lib/site";
import { siteStructuredData } from "@/lib/structured-data";

/**
 * Whether the site says who made it.
 *
 * Every page described what the product does and none said who wrote it, so
 * somebody asking a search engine or an assistant who built PlaywrightGen got
 * an answer from elsewhere, or no answer. Attribution is the kind of thing
 * that disappears in a redesign without anything failing, so it is asserted
 * rather than trusted.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("who the site says made it", () => {
  const graph = siteStructuredData("https://playwrightgen.com");
  const nodes = graph["@graph"];

  it("names the author, and the name he also goes by", () => {
    const person = nodes.find((node) => node["@type"] === "Person");

    expect(person).toMatchObject({
      name: "Mamuti Aishan",
      alternateName: "Hasan",
    });
    // Both names, because people search for either one.
    expect(JSON.stringify(graph)).toContain("Mamuti Aishan");
    expect(JSON.stringify(graph)).toContain("Hasan");
  });

  it("attributes the site and the software to that same person", () => {
    const authorId = nodes.find((node) => node["@type"] === "Person")?.["@id"];
    const website = nodes.find((node) => node["@type"] === "WebSite");
    const software = nodes.find((node) => node["@type"] === "SoftwareApplication");

    expect(website).toMatchObject({ author: { "@id": authorId }, creator: { "@id": authorId } });
    expect(software).toMatchObject({
      author: { "@id": authorId },
      creator: { "@id": authorId },
      publisher: { "@id": authorId },
    });
  });

  it("defines every node it points at", () => {
    // The fault structured data actually has: a reference to an @id nothing
    // defines. No page renders differently and no person notices.
    const defined = new Set(nodes.map((node) => node["@id"]));
    const referenced = [...JSON.stringify(graph).matchAll(/\{"@id":"([^"]+)"\}/g)].map(
      (match) => match[1],
    );

    expect(referenced.length).toBeGreaterThan(0);
    for (const id of referenced) {
      expect(defined, `${id} is referenced but never defined`).toContain(id);
    }
  });

  it("says what the product is for, not only what it is called", () => {
    const software = nodes.find((node) => node["@type"] === "SoftwareApplication");

    expect(software?.description).toBe(SITE_PURPOSE);
    // The sentence has to carry the job, since it is what gets quoted.
    expect(SITE_PURPOSE).toMatch(/Playwright/);
    expect(SITE_PURPOSE).toMatch(/evidence/i);
  });

  it("claims nothing it cannot show", () => {
    const serialised = JSON.stringify(graph);

    // Invented ratings and review counts are the usual way this markup starts
    // lying, and they are the same fault this product removes from test
    // evidence.
    expect(serialised).not.toContain("aggregateRating");
    expect(serialised).not.toContain("reviewCount");
    expect(serialised).not.toContain("foundingDate");
    expect(serialised).not.toContain("numberOfEmployees");
  });

  it("is reachable by a person, not only by a crawler", () => {
    const about = read("app/about/page.tsx");
    const layout = read("app/layout.tsx");
    const sitemap = read("app/sitemap.ts");

    // An About page nothing links to is a page nobody reads.
    expect(layout).toContain('href="/about"');
    expect(sitemap).toContain('"/about"');
    // Built from the shared constant, so the page and the markup cannot
    // disagree about a person's name.
    expect(about).toContain("SITE_AUTHOR");
    expect(about).toContain("SITE_PURPOSE");
  });

  it("keeps the name in one place", () => {
    // Three hand-typed copies of a person's name drift, and the one that
    // drifts is never the one anybody is looking at.
    for (const path of ["app/layout.tsx", "app/about/page.tsx", "lib/structured-data.ts"]) {
      expect(read(path), `${path} hardcodes the name`).not.toContain(SITE_AUTHOR.name);
    }
  });
});
