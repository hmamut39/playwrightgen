import { SignUp } from "@clerk/nextjs";

import { ClerkAuthShell } from "@/components/auth/clerk-auth-shell";
import { CLERK_APPEARANCE } from "@/lib/auth/clerk-appearance";

export const metadata = {
  title: "Create your account",
  description: "Create a free PlaywrightGen account: requirements, reviewed Playwright tests and release evidence in one workspace.",
};

export default function SignUpPage() {
  return (
    <ClerkAuthShell
      eyebrow="Create your workspace"
      title="Turn quality engineering into a team system."
      description="Create an account to organize requirements, test design, automation artifacts, execution evidence, and release intelligence in one secure workspace."
    >
      <SignUp
        appearance={CLERK_APPEARANCE}
        path="/sign-up"
        routing="path"
        fallbackRedirectUrl="/workspace"
        signInUrl="/sign-in"
        signInFallbackRedirectUrl="/workspace"
      />
    </ClerkAuthShell>
  );
}
