import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

/**
 * Public pages are for search engines; the workspace, onboarding and APIs are
 * private to signed-in teams and have nothing to index.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/workspace", "/api/", "/onboarding", "/sign-in/", "/sign-up/"],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
