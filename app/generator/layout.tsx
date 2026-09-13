import type { Metadata } from "next";

import { SHARE_IMAGE } from "@/lib/site";

/** Title and description for a page that is itself a client component. */
export const metadata: Metadata = {
  title: "Free Playwright test generator",
  description:
    "Describe a user flow and paste a page URL: PlaywrightGen opens the real page and writes a reviewable Playwright test with locators taken from its actual buttons and fields.",
  openGraph: { title: "Free Playwright test generator \u00b7 PlaywrightGen", description: "Describe a user flow and paste a page URL: PlaywrightGen opens the real page and writes a reviewable Playwright test with locators taken from its actual buttons and fields." , images: [SHARE_IMAGE] },
  twitter: { card: "summary_large_image", images: [SHARE_IMAGE.url] },
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
