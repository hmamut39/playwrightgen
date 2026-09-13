import { ClerkAuthShell } from "@/components/auth/clerk-auth-shell";
import { WorkspaceOnboardingStep } from "@/components/auth/workspace-onboarding-step";

export const metadata = { title: "Welcome · PlaywrightGen" };

export default function OnboardingPage() {
  return (
    <ClerkAuthShell
      eyebrow="Welcome to PlaywrightGen"
      title="One quick step."
      description="Name the workspace where your projects, test cases and team will live. Then we'll walk you through your first project."
    >
      <WorkspaceOnboardingStep />
    </ClerkAuthShell>
  );
}
