import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";

type WorkspaceShellProps = {
  organizationName: string;
  organizationSlug?: string | null;
};

const switcherAppearance = {
  elements: {
    rootBox: "w-full",
    organizationSwitcherTrigger:
      "w-full justify-between rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-white shadow-none transition-colors hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-cyan-400",
    organizationPreviewMainIdentifier: "text-sm font-medium text-white",
    organizationPreviewSecondaryIdentifier: "text-xs text-slate-400",
    organizationSwitcherTriggerIcon: "text-slate-400",
  },
};

function ShieldIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M12 3 5.5 5.8v5.3c0 4.2 2.6 7.9 6.5 9.8 3.9-1.9 6.5-5.6 6.5-9.8V5.8L12 3Z" />
      <path d="m9.2 12 1.8 1.8 3.9-4" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="m12 3-8 4.5 8 4.5 8-4.5L12 3Z" />
      <path d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path d="M3.5 6.5h6l2 2h9v9.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V6.5Z" />
    </svg>
  );
}

const foundations = [
  {
    title: "Secure team workspace",
    description:
      "Your team enters through an authenticated workspace boundary with account and organization controls built in.",
    icon: <ShieldIcon />,
  },
  {
    title: "Organization isolation",
    description:
      "The active organization establishes the boundary that will keep future projects and workflows separate.",
    icon: <LayersIcon />,
  },
  {
    title: "Project foundation coming next",
    description:
      "Project management will be introduced after Clerk synchronization and authorization are in place.",
    icon: <FolderIcon />,
  },
];

export function WorkspaceShell({
  organizationName,
  organizationSlug,
}: WorkspaceShellProps) {
  return (
    <main className="min-h-[calc(100vh-8rem)] overflow-x-hidden bg-slate-50 text-slate-950 lg:flex">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-800 bg-slate-950 px-5 py-6 text-white lg:flex">
        <div className="flex items-center gap-3 px-1">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-xs font-bold tracking-[-0.02em] text-slate-950">
            PG
          </div>
          <div>
            <p className="font-semibold tracking-[-0.02em]">PlaywrightGen</p>
            <p className="text-xs text-slate-400">Quality workspace</p>
          </div>
        </div>

        <div className="mt-8">
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Active workspace
          </p>
          <OrganizationSwitcher
            afterCreateOrganizationUrl="/workspace"
            afterSelectOrganizationUrl="/workspace"
            hidePersonal
            skipInvitationScreen
            appearance={switcherAppearance}
          />
        </div>

        <nav aria-label="Workspace navigation" className="mt-8">
          <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
            Workspace
          </p>
          <div
            aria-current="page"
            className="flex items-center gap-3 rounded-xl bg-slate-800 px-3 py-2.5 text-sm font-medium text-white"
          >
            <span className="h-2 w-2 rounded-full bg-cyan-400" />
            Overview
          </div>
          <div className="mt-1 flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-slate-400">
            <span className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full border border-slate-600" />
              Projects
            </span>
            <span className="rounded-lg border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
              Coming next
            </span>
          </div>
        </nav>

        <div className="mt-auto border-t border-slate-800 pt-5">
          <p className="mb-3 px-1 text-xs font-medium text-slate-400">
            Account
          </p>
          <UserButton
            showName
            appearance={{
              elements: {
                rootBox: "w-full",
                userButtonTrigger:
                  "w-full justify-start rounded-xl px-2 py-2 text-white transition-colors hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-cyan-400",
                userButtonOuterIdentifier: "text-sm text-white",
              },
            }}
          />
        </div>
      </aside>

      <section className="min-w-0 flex-1" aria-labelledby="workspace-overview-heading">
        <div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-3 lg:hidden">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-[11px] font-bold text-white">
                PG
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-950">
                  PlaywrightGen
                </p>
                <p className="truncate text-xs text-slate-500">
                  {organizationName}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <OrganizationSwitcher
                afterCreateOrganizationUrl="/workspace"
                afterSelectOrganizationUrl="/workspace"
                hidePersonal
                skipInvitationScreen
                appearance={{
                  elements: {
                    organizationSwitcherTrigger:
                      "h-9 max-w-40 rounded-lg border border-slate-200 bg-white px-2 shadow-none focus-visible:ring-2 focus-visible:ring-cyan-500",
                    organizationPreviewMainIdentifier:
                      "max-w-20 truncate text-xs font-medium text-slate-700 sm:max-w-32",
                    organizationPreviewSecondaryIdentifier: "hidden",
                  },
                }}
              />
              <UserButton />
            </div>
          </div>

          <div className="hidden items-center justify-between gap-6 lg:flex">
            <div>
              <p className="text-sm font-medium text-slate-600">
                {organizationName}
              </p>
              {organizationSlug ? (
                <p className="mt-0.5 text-xs text-slate-400">
                  Workspace slug: {organizationSlug}
                </p>
              ) : null}
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Workspace foundation ready
            </span>
          </div>
        </div>

        <div className="px-4 py-7 sm:px-6 sm:py-9 lg:px-8 lg:py-10">
          <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <h1
                id="workspace-overview-heading"
                className="text-2xl font-semibold tracking-[-0.02em] text-slate-950 sm:text-3xl"
              >
                Workspace overview
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
                The secure foundation for your team&apos;s quality engineering
                work in PlaywrightGen.
              </p>
            </div>
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 lg:hidden">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Workspace foundation ready
            </span>
          </header>

          <section className="mt-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
              Active workspace
            </p>
            <h2 className="mt-3 text-xl font-semibold tracking-[-0.02em] text-slate-950 sm:text-2xl">
              Welcome to {organizationName}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">
              Your authenticated team workspace is ready. Project management
              will be enabled in the next product milestone.
            </p>
          </section>

          <section aria-labelledby="foundation-heading" className="mt-7">
            <h2 id="foundation-heading" className="sr-only">
              Workspace foundation
            </h2>
            <div className="grid gap-4 md:grid-cols-3">
              {foundations.map((foundation) => (
                <article
                  key={foundation.title}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-100 bg-cyan-50 text-cyan-700">
                    {foundation.icon}
                  </div>
                  <h3 className="mt-5 text-base font-semibold text-slate-950">
                    {foundation.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {foundation.description}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="next-milestone-heading"
            className="mt-7 rounded-2xl border border-slate-200 bg-slate-100/70 p-5 sm:p-6"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-3xl">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Next milestone
                </p>
                <h2
                  id="next-milestone-heading"
                  className="mt-2 text-lg font-semibold text-slate-950"
                >
                  Projects, backed by synchronized access
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Projects will be introduced after Clerk synchronization and
                  workspace authorization are implemented, so every project is
                  associated with the correct team from the start.
                </p>
              </div>
              <span className="w-fit shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
                Coming next
              </span>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
