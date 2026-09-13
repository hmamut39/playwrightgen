import type { Metadata } from "next";

/** Title and description for a page that is itself a client component. */
export const metadata: Metadata = {
  title: "Free Playwright coverage review",
  description:
    "Paste your requirement and Playwright tests, add the page URL, and see which controls your tests never reach, with the next tests worth writing.",
  openGraph: { title: "Free Playwright coverage review \u00b7 PlaywrightGen", description: "Paste your requirement and Playwright tests, add the page URL, and see which controls your tests never reach, with the next tests worth writing." },
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
