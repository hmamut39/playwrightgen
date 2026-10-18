import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SiteNavigation } from "@/components/site-navigation";
import { SiteStructuredData } from "@/components/site-structured-data";
import { validatePublicClerkEnvironment } from "@/lib/env";
import {
  SHARE_IMAGE,
  SITE_AUTHOR,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  siteUrl,
} from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  // Every page had the same title and a description from an earlier
  // positioning, so browser tabs, search results and shared links could not
  // tell one page from another. Pages now set their own title into this
  // template.
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  // Named here as well as in the structured data, because the two are read
  // by different things and a page that says neither leaves the question to
  // whatever else the web holds.
  authors: [{ name: SITE_AUTHOR.name, url: SITE_AUTHOR.url }],
  creator: SITE_AUTHOR.name,
  publisher: SITE_AUTHOR.name,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Know what to test. Know whether to ship.`,
    description: SITE_DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    images: [SHARE_IMAGE.url],
    title: `${SITE_NAME} — Know what to test. Know whether to ship.`,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY } =
    validatePublicClerkEnvironment();

  return (
    <ClerkProvider
      publishableKey={NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/workspace"
      signUpFallbackRedirectUrl="/workspace"
      // Our own first step instead of Clerk's "Setup your organization" form.
      taskUrls={{ "choose-organization": "/onboarding" }}
    >
      <html lang="en">
        <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
          <SiteStructuredData />
          <div className="min-h-screen bg-[#fafafa] text-black">
            <SiteNavigation />

            {children}

            <footer className="mt-20 border-t py-6 text-center text-sm text-slate-500">
              <div className="flex flex-wrap justify-center gap-6">
                <a href="/about" className="hover:text-black">
                  About
                </a>
                <a href="/terms" className="hover:text-black">
                  Terms
                </a>
                <a href="/privacy" className="hover:text-black">
                  Privacy
                </a>
              </div>
              {/* On every page, because the question is asked from every
                  page and an About link alone answers it one click late. */}
              <p className="mt-4 px-6 text-xs leading-5 text-slate-500">
                {SITE_NAME} is built by{" "}
                <a
                  href={SITE_AUTHOR.url}
                  rel="author noreferrer"
                  target="_blank"
                  className="font-medium text-slate-700 underline underline-offset-2 hover:text-black"
                >
                  {SITE_AUTHOR.name} ({SITE_AUTHOR.alternateName})
                </a>
                .
              </p>
            </footer>
          </div>
        </body>
      </html>
    </ClerkProvider>
  );
}
