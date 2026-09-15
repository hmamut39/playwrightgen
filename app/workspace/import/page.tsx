import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  FreeToolImport,
  type FreeToolImportState,
} from "@/components/workspace/free-tool-import";
import { WorkspaceOnboarding } from "@/components/workspace/workspace-onboarding";
import { freeToolHandoffSchema } from "@/lib/free-tools/handoff";
import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { listProjects } from "@/lib/services/projects";
import { createRequirement } from "@/lib/services/requirements";
import { createTestCase } from "@/lib/services/test-cases";
import { recordImportedDraft } from "@/lib/services/imported-drafts";

function lines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export default async function WorkspaceImportPage() {
  const { userId, orgId, redirectToSignIn } = await auth();

  if (!userId) {
    return redirectToSignIn({ returnBackUrl: "/workspace/import" });
  }

  if (!orgId) return <WorkspaceOnboarding returnUrl="/workspace/import" />;

  const context = await requireWorkspaceContext();
  const orgSlug = context.organization.slug;
  const projects = await listProjects({ orgSlug });

  async function importAction(
    _state: FreeToolImportState,
    formData: FormData,
  ): Promise<FreeToolImportState> {
    "use server";

    let rawHandoff: unknown;
    try {
      rawHandoff = JSON.parse(String(formData.get("handoff") ?? "null"));
    } catch {
      return { error: "The preliminary result is invalid or expired." };
    }
    const parsed = freeToolHandoffSchema.safeParse(rawHandoff);
    if (!parsed.success) return { error: "The preliminary result is invalid or expired." };

    const projectId = String(formData.get("projectId") ?? "");
    const title = String(formData.get("title") ?? "");
    const summary = String(formData.get("summary") ?? "");
    const acceptanceCriteria = String(formData.get("acceptanceCriteria") ?? "");
    const steps = lines(String(formData.get("steps") ?? ""));

    try {
      if (parsed.data.target === "TEST_CASE") {
        const testCase = await createTestCase({
          orgSlug,
          projectId,
          title,
          objective: summary,
          steps,
          expectedResults: lines(acceptanceCriteria),
          type: parsed.data.testType ?? "FUNCTIONAL",
          source: "AI_SUGGESTED",
          tags: [...parsed.data.tags, "free-tool-import"],
          automationStatus: "CANDIDATE",
        });
        const draft = parsed.data.draft;
        if (draft) {
          // The Test Case is already created; losing the attached code should
          // not undo it, so a failure here is logged rather than shown.
          await recordImportedDraft({
            organizationId: context.organization.id,
            projectId: testCase.projectId,
            testCaseId: testCase.id,
            userId: context.user.id,
            source: parsed.data.source,
            code: draft.code,
            pageUrl: draft.pageUrl,
            receipt: draft.receipt,
          }).catch((error: unknown) => console.error("[import] could not keep the imported code", error));
        }
        redirect(`/workspace/${orgSlug}/projects/${projectId}/test-cases/${testCase.id}`);
      }

      const requirement = await createRequirement({
        orgSlug,
        projectId,
        title,
        description: summary,
        acceptanceCriteria,
        externalReference: parsed.data.externalReference || null,
        source: "AI_SUGGESTED",
      });
      redirect(`/workspace/${orgSlug}/projects/${projectId}/requirements/${requirement.id}`);
    } catch (error) {
      if (error && typeof error === "object" && "digest" in error) throw error;
      return {
        error:
          error instanceof Error && error.message.startsWith("invalid_")
            ? "Review the draft fields and select a project where your role can create this item."
            : "The draft could not be created in this project. Check your project role and try again.",
      };
    }
  }

  return (
    <main className="min-h-[calc(100vh-9rem)] bg-slate-50 px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <Link href="/workspace" className="text-sm font-semibold text-cyan-700 hover:text-cyan-900">
          ← Workspace
        </Link>
        <p className="mt-8 text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Trusted transition</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.045em] text-slate-950 sm:text-5xl">
          Continue preliminary work inside a real project
        </h1>
        <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
          Choose the destination, review the proposed content, and create a draft.
          Nothing is approved or treated as verified automation during import.
        </p>

        <div className="mt-8">
          {projects.length === 0 ? (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              This organization has no active project available. Create a project first; your pending result will remain in this browser tab.
            </div>
          ) : null}
          <FreeToolImport projects={projects.map(({ id, name, description }) => ({ id, name, description }))} action={importAction} />
        </div>
      </div>
    </main>
  );
}
