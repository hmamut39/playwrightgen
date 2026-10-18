import { ClerkProvider } from "@clerk/nextjs";

import { validatePublicClerkEnvironment } from "@/lib/env";

/**
 * Clerk, mounted only where somebody signs in or is signed in.
 *
 * This used to wrap the whole application from the root layout, which meant
 * every visitor to the home page, the pricing page or the MCP page
 * downloaded clerk-js and the Clerk UI bundle -- 212kB to support a session
 * none of those pages reads. They are the pages a stranger meets first.
 *
 * The provider does not have to be the outermost component; it has to be
 * above anything that uses Clerk. That is the workspace, the two sign-in
 * routes, onboarding, and the two free tools that tailor one sentence to
 * whether you are signed in.
 */
export function ClerkArea({ children }: Readonly<{ children: React.ReactNode }>) {
  const { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY } = validatePublicClerkEnvironment();
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
      {children}
    </ClerkProvider>
  );
}
