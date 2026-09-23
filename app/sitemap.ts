import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";

const PUBLIC_PAGES: Array<{ path: string; priority: number }> = [
  { path: "/", priority: 1 },
  { path: "/generator", priority: 0.9 },
  { path: "/coverage-review", priority: 0.8 },
  { path: "/engineering-review", priority: 0.8 },
  { path: "/mcp", priority: 0.8 },
  { path: "/pricing", priority: 0.7 },
  { path: "/sign-up", priority: 0.5 },
  { path: "/privacy", priority: 0.2 },
  { path: "/terms", priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  return PUBLIC_PAGES.map((page) => ({
    url: `${base}${page.path === "/" ? "" : page.path}`,
    changeFrequency: "weekly",
    priority: page.priority,
  }));
}
