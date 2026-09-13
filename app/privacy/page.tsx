import Link from "next/link";

export const metadata = {
  title: "Privacy",
  description: "How PlaywrightGen handles your data.",
};

const sections = [
  {
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
    title: "Why it is processed",
    body: [
      "To authenticate users, isolate organizations, operate the quality workflow, import reviewable repository evidence, generate requested AI output, prevent abuse, diagnose failures, and prepare an optional team-access launch.",
      "Operational logs are designed to contain request IDs, safe outcome codes, latency, and aggregate token usage—not prompts, uploads, webhook bodies, secrets, raw provider errors, or email addresses.",
    ],
  },
  {
    title: "Service providers",
    body: [
      "The current stack uses Clerk for identity, Neon/PostgreSQL for domain records, Vercel for hosting, GitHub for repository evidence, OpenAI for AI workflows, Upstash Redis for rate limits and the preview waitlist, Resend for optional waitlist notifications, and Stripe for isolated billing tests.",
      "Each provider processes data under its own terms and configuration. Production launch requires a reviewed subprocessor list, regional transfer position, and final retention schedule.",
    ],
  },
  {
    title: "Storage, retention, and your choices",
    body: [
      "The browser uses session storage for temporary handoff between a free tool and Workspace. A legacy local sign-in page may store an email on the device; that value is not authorization authority.",
      "Workspace records are retained for the protected preview so version history and audit evidence remain reviewable. A complete account-deletion, export, legal-hold, and backup-retention process is still a production gate.",
      "Do not submit passwords, API keys, payment details, health information, or other unnecessary sensitive data. You may stop using the preview and sign out at any time.",
    ],
  },
] as const;

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-700 sm:px-6 lg:py-14">
      <article className="mx-auto max-w-4xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
        <header className="bg-slate-950 px-6 py-10 text-white sm:px-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">
            Protected product preview
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em]">
            Privacy notice
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
            This notice describes the current PlaywrightGen preview. It is not a
            claim that paid Production, regional compliance, or a final deletion
            program is ready.
          </p>
          <p className="mt-5 text-xs text-slate-400">Last updated: September 1, 2026</p>
        </header>

        <div className="space-y-9 px-6 py-9 sm:px-10">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-semibold text-slate-950">{section.title}</h2>
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

          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h2 className="font-semibold text-amber-950">Before public or paid launch</h2>
            <p className="mt-2 text-sm leading-6 text-amber-900">
              PlaywrightGen must publish the operating entity, privacy/support
              contact, user-rights request process, jurisdiction-specific terms,
              final retention/deletion schedule, and reviewed subprocessor list.
              Until then, paid checkout remains disabled.
            </p>
          </section>

          <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-6 text-sm">
            <Link href="/terms" className="font-semibold text-cyan-700 hover:text-cyan-600">
              Preview terms
            </Link>
            <Link href="/pricing" className="font-semibold text-cyan-700 hover:text-cyan-600">
              Current pricing status
            </Link>
          </div>
        </div>
      </article>
    </main>
  );
}
