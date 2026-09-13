import { ClerkAuthShell } from "@/components/auth/clerk-auth-shell";
import { WorkspaceOnboardingStep } from "@/components/auth/workspace-onboarding-step";

export const metadata = { title: "Welcome" };

export default function OnboardingPage() {
  return (
    <ClerkAuthShell
      eyebrow="Welcome to PlaywrightGen"
      title="One quick step."
      description="Join the team that invited you, or name a new workspace for your projects and team. Every screen after this tells you what to do next."
    >
      <WorkspaceOnboardingStep />
    </ClerkAuthShell>
  );
}
