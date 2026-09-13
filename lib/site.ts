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
  "Turn requirements into reviewed Playwright tests, run them in your own CI, and see whether a release is safe to ship — with every approval and result on record.";
