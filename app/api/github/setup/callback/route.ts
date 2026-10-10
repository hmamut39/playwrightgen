import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireWorkspaceContext } from "@/lib/auth/workspace-context";
import { validateGitHubSetupEnvironment } from "@/lib/env";
import {
  exchangeGitHubUserCode,
  getVerifiedGitHubInstallation,
  GitHubProviderError,
  verifyGitHubUserInstallationAccess,
} from "@/lib/integrations/github/app-client";
import {
  createPkceChallenge,
  GITHUB_PKCE_COOKIE,
  verifyGitHubSetupState,
} from "@/lib/integrations/github/setup-state";
import { bindGitHubInstallation } from "@/lib/services/repository-imports";

export const runtime = "nodejs";

const codeSchema = z.string().trim().min(1).max(512);

function projectRepositoriesUrl(
  appUrl: string,
  orgSlug: string,
  projectId: string,
  result: "connected" | "failed" | "permissions_failed",
) {
  const url = new URL(
    "/workspace/" +
      encodeURIComponent(orgSlug) +
      "/projects/" +
      encodeURIComponent(projectId) +
      "/repositories",
    appUrl,
  );
  url.searchParams.set("github", result);
  return url;
}

export async function GET(request: NextRequest) {
  let fallbackUrl: URL | null = null;
  let permissionsFallbackUrl: URL | null = null;
  try {
    const environment = validateGitHubSetupEnvironment();
    const state = verifyGitHubSetupState(
      request.nextUrl.searchParams.get("state") ?? "",
      environment.GITHUB_SETUP_STATE_SECRET,
      { phase: "oauth" },
    );
    fallbackUrl = projectRepositoriesUrl(
      environment.NEXT_PUBLIC_APP_URL,
      state.orgSlug,
      state.projectId,
      "failed",
    );
    permissionsFallbackUrl = projectRepositoriesUrl(
      environment.NEXT_PUBLIC_APP_URL,
      state.orgSlug,
      state.projectId,
      "permissions_failed",
    );
    if (request.nextUrl.searchParams.get("error")) {
      return NextResponse.redirect(fallbackUrl);
    }
    const code = codeSchema.parse(request.nextUrl.searchParams.get("code"));
    const codeVerifier = request.cookies.get(GITHUB_PKCE_COOKIE)?.value;
    if (
      !codeVerifier ||
      createPkceChallenge(codeVerifier) !== state.codeChallenge ||
      !state.installationId
    ) {
      throw new Error("github_pkce_mismatch");
    }
    const workspace = await requireWorkspaceContext({
      organizationId: state.organizationId,
      orgSlug: state.orgSlug,
      projectId: state.projectId,
      permission: "organization:manage",
    });
    if (workspace.user.id !== state.userId) {
      throw new Error("github_setup_user_mismatch");
    }

    const callbackUrl = new URL(
      "/api/github/setup/callback",
      environment.NEXT_PUBLIC_APP_URL,
    ).toString();
    const userToken = await exchangeGitHubUserCode({
      code,
      codeVerifier,
      redirectUri: callbackUrl,
    });
    await verifyGitHubUserInstallationAccess({
      installationId: state.installationId,
      userToken,
    });
    const installation = await getVerifiedGitHubInstallation({
      installationId: state.installationId,
    });
    await bindGitHubInstallation(
      {
        orgSlug: state.orgSlug,
        ...installation,
        requestId: state.nonce,
      },
    );

    const response = NextResponse.redirect(
      projectRepositoriesUrl(
        environment.NEXT_PUBLIC_APP_URL,
        state.orgSlug,
        state.projectId,
        "connected",
      ),
    );
    response.cookies.delete(GITHUB_PKCE_COOKIE);
    return response;
  } catch (error: unknown) {
    // One failure deserves its own name. The App's permissions not matching
    // what this deployment allows is a configuration problem with a known
    // fix, and reporting it as "GitHub access could not be verified" sent
    // people looking at their repository, their token and their network.
    if (
      error instanceof GitHubProviderError &&
      error.code === "github_permissions_not_least_privilege" &&
      permissionsFallbackUrl
    ) {
      return NextResponse.redirect(permissionsFallbackUrl);
    }
    if (fallbackUrl) return NextResponse.redirect(fallbackUrl);
    return NextResponse.json(
      { status: "error", code: "github_setup_failed" },
      { status: 400 },
    );
  }
}
