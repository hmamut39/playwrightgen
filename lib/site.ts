/**
 * The public address of the site, for absolute links in metadata, the
 * sitemap and social previews. Falls back to the production domain so a
 * missing variable never produces localhost links in a shared card.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured && !/localhost|127\.0\.0\.1/.test(configured)) return configured;
  return "https://playwrightgen.com";
}

export const SITE_NAME = "PlaywrightGen";
export const SITE_TAGLINE = "Evidence-backed quality for Playwright teams";
export const SITE_DESCRIPTION =
  "Playwright tests written from your real page, run in a real browser and fixed until they pass — then reviewed by your team, with every approval and result on record.";

/**
 * Who made this.
 *
 * Nothing on the site said. Somebody asking a search engine or an assistant
 * who built PlaywrightGen, or what it is for, found no answer on the site
 * itself, so the answer came from whatever else the web happened to hold.
 * Named in one place because it is repeated in the page, the metadata and
 * the structured data, and three copies of a person's name drift.
 */
export const SITE_AUTHOR = {
  name: "Mamuti Aishan",
  /** The name he also goes by, so either one finds him. */
  alternateName: "Hasan",
  url: "https://github.com/hmamut39",
} as const;

/** One sentence on what the product is for, for a reader and for a crawler. */
export const SITE_PURPOSE =
  "PlaywrightGen writes Playwright end-to-end tests from a real page, proves them in a real browser, and keeps the record of who proposed, approved and accepted each one, so a team can say what their release evidence actually shows.";

/**
 * The generated share card. A page that sets its own openGraph replaces the
 * site-wide one, image included, so pages with their own titles name it again.
 */
export const SHARE_IMAGE = { url: "/opengraph-image", width: 1200, height: 630 };
