import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { SiteNavigation } from "@/components/site-navigation";
import { validatePublicClerkEnvironment } from "@/lib/env";
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
  title: "PlaywrightGen",
  description:
    "AI-powered Playwright test generation for developers, automation engineers, and SDETs.",
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
          <div className="min-h-screen bg-[#fafafa] text-black">
            <SiteNavigation />

            {children}

            <footer className="mt-20 border-t py-6 text-center text-sm text-gray-500">
              <div className="flex justify-center gap-6">
                <a href="/terms" className="hover:text-black">
                  Terms
                </a>
                <a href="/privacy" className="hover:text-black">
                  Privacy
                </a>
              </div>
            </footer>
          </div>
        </body>
      </html>
    </ClerkProvider>
  );
}
