import { ClerkAuthShell } from "@/components/auth/clerk-auth-shell";
import { WorkspaceOnboardingStep } from "@/components/auth/workspace-onboarding-step";

/**
 * Shown to a signed-in person with no active workspace.
 *
 * Uses the same step as a brand-new account, so "create, join, or open a
 * workspace" reads the same wherever someone meets it, in the product's own
 * words rather than Clerk's "organization" screens.
 */
export function WorkspaceOnboarding({ returnUrl = "/workspace" }: { returnUrl?: string }) {
  return (
    <ClerkAuthShell
      eyebrow="PlaywrightGen workspace"
      title="Choose where to work."
      description="Open a workspace you belong to, accept an invitation, or start a new one for your team."
    >
      <WorkspaceOnboardingStep returnUrl={returnUrl} />
    </ClerkAuthShell>
  );
}
