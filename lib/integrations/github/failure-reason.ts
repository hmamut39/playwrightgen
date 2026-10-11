/**
 * What went wrong connecting or importing a repository, in words.
 *
 * Fifteen distinct causes used to arrive at the same sentence: "GitHub access
 * or repository evidence could not be verified." A suspended installation, a
 * repository that is not public, an App whose permissions no longer match, a
 * repository renamed since it was connected -- every one of them sent somebody
 * to look at the wrong thing, and most have a fix that takes a minute once it
 * is named.
 *
 * Only causes that point at an action are listed. Anything else falls back to
 * the general message rather than being dressed up as advice, and the mapping
 * is an allowlist so an unknown code arriving in a URL renders nothing of its
 * own.
 *
 * Nothing here names a token, a secret, a private repository or an account
 * that the person cannot already see.
 */

const REASONS: Record<string, string> = {
  github_installation_suspended:
    "The GitHub App installation is suspended, so nothing can be read through it. An administrator can re-enable it in the repository owner's GitHub settings.",
  github_permissions_not_least_privilege:
    "The GitHub App's permissions do not match what this deployment allows. This is a setting on the App rather than anything about your repository: it needs repository contents and pull requests at write, metadata and issues at read, and nothing else.",
  github_installation_app_mismatch:
    "That installation belongs to a different GitHub App than this deployment uses. Connect through the installation this deployment created.",
  github_repository_not_public:
    "That repository is not public. A private repository has to be connected through an App installation rather than by URL.",
  github_repository_list_too_large:
    "This installation can reach too many repositories to list. On GitHub, limit the App to the repositories you want PlaywrightGen to see, then try again.",
  github_repository_access_not_verified:
    "This installation cannot reach that repository. On GitHub, add it to the repositories the App may access, then try again.",
  github_public_repository_not_verified:
    "GitHub did not confirm that address as a public repository under that owner and name. Check the spelling, or connect it through an App installation if it is private.",
  // Names the fact and not the workspace: which other organization holds
  // the installation is not this one's business.
  github_installation_already_connected:
    "That GitHub installation is already connected to a different workspace. An installation belongs to one workspace at a time, so disconnect it there first, or install the App separately for this one.",
  github_installation_not_found:
    "That GitHub installation is no longer connected to this workspace. Connect it again and retry.",
  invalid_repository_input:
    "That does not read as a repository address. It should look like https://github.com/owner/repository.",
  repository_connection_not_found:
    "That connection no longer exists, so there was nothing to import from. Connect the repository again.",
  repository_identity_mismatch:
    "The repository has been renamed, replaced or moved since it was connected, so the import was stopped rather than attached to the wrong source. Reconnect it to continue.",
  /** What the OAuth setup callback redirects with for the same cause. */
  permissions_failed:
    "The GitHub App's permissions do not match what this deployment allows. This is a setting on the App rather than anything about your repository: it needs repository contents and pull requests at write, metadata and issues at read, and nothing else.",
  github_response_invalid:
    "GitHub answered with something this deployment could not read. Nothing was changed; trying again usually works.",
};

export function githubFailureReason(code: string | undefined | null): string | null {
  if (!code) return null;
  return REASONS[code] ?? null;
}

/** Whether a code is one this deployment is willing to repeat back in a URL. */
export function isKnownGitHubFailure(code: string | undefined | null): boolean {
  return githubFailureReason(code) !== null;
}
