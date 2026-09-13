import type { Metadata } from "next";

/** Title and description for a page that is itself a client component. */
export const metadata: Metadata = {
  title: "Free release impact review",
  description:
    "Describe a change before it ships and get its direct and downstream impact, the failure modes to guard against, and concrete Given/When/Then tests.",
  openGraph: { title: "Free release impact review \u00b7 PlaywrightGen", description: "Describe a change before it ships and get its direct and downstream impact, the failure modes to guard against, and concrete Given/When/Then tests." },
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
