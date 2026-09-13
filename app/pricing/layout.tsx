import type { Metadata } from "next";

/** Title and description for a page that is itself a client component. */
export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Free tools with no account, and a Team plan for reviewed tests, CI evidence, team roles and release reports, with a free trial.",
  openGraph: { title: "Pricing \u00b7 PlaywrightGen", description: "Free tools with no account, and a Team plan for reviewed tests, CI evidence, team roles and release reports, with a free trial." },
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
