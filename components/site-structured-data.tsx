import { siteStructuredData } from "@/lib/structured-data";

/**
 * The site's structured data, serialised into the page.
 *
 * The graph itself lives in `lib/structured-data` so its shape can be tested;
 * this only puts it on the page.
 */
export function SiteStructuredData() {
  return (
    <script
      type="application/ld+json"
      // Built from constants in this repository, never from anything a visitor
      // or a customer supplied.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(siteStructuredData()) }}
    />
  );
}
