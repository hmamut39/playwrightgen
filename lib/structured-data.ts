import { SITE_AUTHOR, SITE_DESCRIPTION, SITE_NAME, SITE_PURPOSE, siteUrl } from "@/lib/site";

/**
 * Who made PlaywrightGen and what it is for, in the form machines read.
 *
 * Asked who built this, a search engine or an assistant had nothing on the
 * site to go on: every page said what the product does and none said who wrote
 * it, so an answer came from whatever else the web happened to hold, or did
 * not come at all.
 *
 * A pure function rather than markup inside the component, so the shape can be
 * tested: the thing that goes wrong with structured data is a reference to an
 * `@id` that nothing defines, which no page renders differently and no person
 * notices.
 *
 * Deliberately modest in what it claims. No ratings, no invented founding
 * date, no organisation with employees it does not have. Markup that overstates
 * is the same fault this product spends its time removing from test evidence,
 * and search engines discount it anyway.
 */
export function siteStructuredData(base: string = siteUrl()) {
  const authorId = `${base}/#author`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        "@id": authorId,
        name: SITE_AUTHOR.name,
        alternateName: SITE_AUTHOR.alternateName,
        url: SITE_AUTHOR.url,
        sameAs: [SITE_AUTHOR.url],
      },
      {
        "@type": "WebSite",
        "@id": `${base}/#website`,
        url: base,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        inLanguage: "en",
        author: { "@id": authorId },
        creator: { "@id": authorId },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${base}/#software`,
        name: SITE_NAME,
        url: base,
        applicationCategory: "DeveloperApplication",
        applicationSubCategory: "Software testing",
        operatingSystem: "Web browser",
        description: SITE_PURPOSE,
        author: { "@id": authorId },
        creator: { "@id": authorId },
        publisher: { "@id": authorId },
        // Stated because "is it free" is the first thing anyone asks, and a
        // missing offer reads as unknown rather than as free.
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          description: "Free tools with no account. Paid plans for team workspaces.",
        },
      },
    ],
  };
}
