import { notFound } from "next/navigation";

import { WorkspaceFrame } from "@/components/workspace/workspace-frame";
import { WorkspaceAuthorizationError, requireWorkspaceContext } from "@/lib/auth/workspace-context";

export default async function OrganizationWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  /*
   * A workspace that is not there is not found, not broken.
   *
   * `requireWorkspaceContext` throws a typed error, which API routes depend
   * on to answer with the right status. A server component has no such
   * handler, so the exception reached the error boundary and the reader was
   * told: "This page didn't load. If you just created your workspace, it may
   * still be finishing setup. Trying again usually works."
   *
   * For a 404 every word of that is false. The owner hit it on 2026-11-22
   * opening his own demo workspace, pressed Try again three times -- the log
   * shows all three -- and had no way to learn that the workspace simply was
   * not his to open. The advice that sounds kindest is the one that wastes
   * the most time.
   *
   * Only the 404 is translated. A 401 or 403 means the workspace exists and
   * this person may not see it, which the error boundary states correctly and
   * which must not be softened into "not found" either.
   */
  let context;
  try {
    context = await requireWorkspaceContext({ orgSlug });
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  return (
    <WorkspaceFrame
      organizationName={context.organization.name}
      organizationSlug={context.organization.slug}
    >
      {children}
    </WorkspaceFrame>
  );
}
