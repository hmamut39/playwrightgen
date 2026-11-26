import Link from "next/link";

import { PageSectionIndex, type PageSection } from "@/components/page-section-index";

export const metadata = {
  title: "Privacy",
  description: "How PlaywrightGen handles your data.",
};

/**
 * What the preview does with your data, as a document a reader can navigate.
 *
 * Four sections and no anchors: nothing here could be linked to, and the only
 * way to find the one answer somebody arrived for -- which providers see this,
 * what is kept, what is not -- was to read all of it. A privacy notice is
 * read by people with a single specific question.
 *
 * The ids are written down rather than derived from the titles, so editing a
 * heading cannot silently break a link somebody saved. See the same note on
 * the terms page.
 */
const sections = [
  {
    id: "what-the-preview-processes",
    title: "What the preview processes",
    body: [
      "Clerk identity, organization, and membership identifiers needed to authenticate you and enforce tenant access.",
      "Workspace records your team creates, including projects, requirements, test cases, automation revisions, test-run evidence, and review activity.",
      "Read-only GitHub installation, repository, commit, configuration, file-path, and test-inventory metadata. Repository source bodies are not retained by the current importer.",
      "Prompts, attachments, or evidence you submit to an AI workflow. These inputs are sent to the configured AI provider to produce the requested result.",
      "A waitlist email address when you choose to join. New waitlist records expire after 180 days unless the launch process replaces that policy with a reviewed notice.",
      "Test-mode billing identifiers and subscription state during internal validation. PlaywrightGen does not store full card details, and paid checkout is not available in the current preview.",
    ],
  },
  {
    id: "why-it-is-processed",
    title: "Why it is processed",
    body: [
      "To authenticate users, isolate organizations, operate the quality workflow, import reviewable repository evidence, generate requested AI output, prevent abuse, diagnose failures, and prepare an optional team-access launch.",
      "Operational logs are designed to contain request IDs, safe outcome codes, latency, and aggregate token usage—not prompts, uploads, webhook bodies, secrets, raw provider errors, or email addresses.",
    ],
  },
  {
    id: "service-providers",
    title: "Service providers",
    body: [
      "The current stack uses Clerk for identity, Neon/PostgreSQL for domain records, Vercel for hosting, GitHub for repository evidence, OpenAI for AI workflows, Upstash Redis for rate limits and the preview waitlist, Resend for optional waitlist notifications, and Stripe for isolated billing tests.",
      "Each provider processes data under its own terms and configuration. Production launch requires a reviewed subprocessor list, regional transfer position, and final retention schedule.",
    ],
  },
  {
    id: "storage-retention-and-your-choices",
    title: "Storage, retention, and your choices",
    body: [
      "The browser uses session storage for temporary handoff between a free tool and Workspace. A legacy local sign-in page may store an email on the device; that value is not authorization authority.",
      "Workspace records are retained for the protected preview so version history and audit evidence remain reviewable. A complete account-deletion, export, legal-hold, and backup-retention process is still a production gate.",
      "Do not submit passwords, API keys, payment details, health information, or other unnecessary sensitive data. You may stop using the preview and sign out at any time.",
    ],
  },
] as const;

/** The launch gate is in the index: it is the part that limits everything above. */
const INDEX: readonly PageSection[] = [
  ...sections.map((section) => ({ id: section.id, label: section.title })),
  { id: "before-public-or-paid-launch", label: "Before public or paid launch" },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 text-slate-700 sm:px-6 lg:py-14">
      <section className="relative overflow-hidden rounded-[2rem] bg-slate-950 px-6 py-10 text-white shadow-xl sm:px-10 sm:py-12">
        <div className="pointer-events-none absolute right-[-8rem] top-[-10rem] h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">
            Protected product preview
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.035em]">
            Privacy notice
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
            This notice describes the current PlaywrightGen preview. It is not a
            claim that paid Production, regional compliance, or a final deletion
            program is ready.
          </p>
          <p className="mt-5 text-xs text-slate-400">Last updated: September 1, 2026</p>
        </div>
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10">
        <PageSectionIndex sections={INDEX} />

        <div className="min-w-0 space-y-6">
          {sections.map((section) => (
            <section
              key={section.id}
              className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
            >
              <h2 id={section.id} className="scroll-mt-24 text-xl font-semibold text-slate-950">
                {section.title}
              </h2>
              <ul className="mt-4 space-y-3">
                {section.body.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-6">
                    <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-600" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section className="rounded-[2rem] border border-amber-200 bg-amber-50 p-6 sm:p-8">
            <h2
              id="before-public-or-paid-launch"
              className="scroll-mt-24 font-semibold text-amber-950"
            >
              Before public or paid launch
            </h2>
            <p className="mt-2 text-sm leading-6 text-amber-900">
              PlaywrightGen must publish the operating entity, privacy/support
              contact, user-rights request process, jurisdiction-specific terms,
              final retention/deletion schedule, and reviewed subprocessor list.
              Until then, paid checkout remains disabled.
            </p>
          </section>

          <div className="flex flex-wrap gap-4 border-t border-slate-200 pt-6 text-sm">
            <Link
              href="/terms"
              className="inline-flex min-h-9 items-center font-semibold text-cyan-700 hover:text-cyan-600"
            >
              Preview terms
            </Link>
            <Link
              href="/pricing"
              className="inline-flex min-h-9 items-center font-semibold text-cyan-700 hover:text-cyan-600"
            >
              Current pricing status
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
