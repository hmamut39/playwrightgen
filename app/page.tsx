import Link from "next/link";

const evidenceFlow = [
  {
    step: "01",
    label: "Requirement",
    title: "Define approved intent",
    description:
      "Keep acceptance criteria, ownership, review state, and every material revision inspectable.",
    status: "Versioned",
  },
  {
    step: "02",
    label: "Test Case",
    title: "Make coverage explicit",
    description:
      "Link business intent to structured scenarios, expected outcomes, priority, and review history.",
    status: "Traceable",
  },
  {
    step: "03",
    label: "Automation",
    title: "Generate reviewable code",
    description:
      "Create separate Browser and API artifacts with deterministic validation and human approval.",
    status: "Reviewable",
  },
  {
    step: "04",
    label: "Run Evidence",
    title: "Preserve what happened",
    description:
      "Keep each result, step outcome, environment, failure detail, and evidence link immutable.",
    status: "Evidence-bound",
  },
  {
    step: "05",
    label: "Release Decision",
    title: "Act on the real gaps",
    description:
      "See missing coverage, unresolved failures, stale evidence, and the next highest-value action.",
    status: "Explainable",
  },
] as const;

const freeTools = [
  {
    number: "01",
    title: "Quick Generate",
    description:
      "Describe the behaviour and give a URL. It reads the real page, writes the Playwright test, runs it in a real browser and fixes it until it passes.",
    href: "/generator",
    action: "Write and prove a test",
  },
  {
    number: "02",
    title: "Coverage Review",
    description:
      "Find the gaps, brittle patterns and weak assertions in your tests, run them on the live page, and prove the tests you are missing.",
    href: "/intelligence",
    action: "Review test coverage",
  },
  {
    number: "03",
    title: "Release Review",
    description:
      "Inspect supplied change evidence for likely impact, uncertainty, and the engineering follow-up a release may need.",
    href: "/engineering-review",
    action: "Review a change",
  },
] as const;

const workspaceCapabilities = [
  "Organization and project isolation",
  "Immutable Requirement and Test Case versions",
  "Requirement-to-Test Case traceability",
  "Separate Browser and API automation engines",
  "Append-only run attempts and failure evidence",
  "Members write, leads approve, nobody approves their own work",
  "Results from your own CI, pinned to approved versions",
  "Cover a whole page: plan its tests, approve, prove each one",
  "Automation run on your live site before anyone reviews it",
  "Connects to VS Code, Cursor and Claude Code over MCP",
] as const;

const integrations = [
  {
    label: "Your editor",
    title: "Approved tests, inside VS Code, Cursor and Claude Code",
    description:
      "Connect your editor's AI assistant over MCP. In one call it writes a test from the real page and makes it pass, then proposes it with that evidence; it also pulls approved automation into your repository.",
    detail: "Proposes, never approves · personal token · revoked when access ends",
  },
  {
    label: "Your CI",
    title: "Your runners, your secrets, our evidence",
    description:
      "Tests run in your own GitHub Actions. Only a bounded summary of results comes back, and each one attaches to the exact approved version it exercised.",
    detail: "Signed reports · nothing of yours executes here",
  },
  {
    label: "Your team",
    title: "A second pair of eyes on every approval",
    description:
      "Members write requirements, test cases and automation. Leads approve them. Nobody approves their own submission while someone else can, and every step shows who did it and when.",
    detail: "Leads · Members · Viewers · review queue",
  },
] as const;

const principles = [
  {
    title: "Evidence before confidence",
    description:
      "Every durable quality claim should link back to the Requirement, Test Case, artifact, run, or finding that supports it.",
  },
  {
    title: "AI proposes. Teams approve.",
    description:
      "AI can review, generate, and diagnose. It cannot silently change approved intent or turn generated output into trusted automation.",
  },
  {
    title: "History stays inspectable",
    description:
      "Versions and execution attempts are preserved so a later edit never changes what the team previously reviewed or ran.",
  },
] as const;

const audiences = [
  {
    role: "QA and SDET leads",
    outcome:
      "Connect planning, automation, execution, and failure review without maintaining separate evidence spreadsheets.",
  },
  {
    role: "Developers",
    outcome:
      "Get a clear next test, inspect generated Playwright code, and understand failures without losing engineering context.",
  },
  {
    role: "Engineering managers",
    outcome:
      "See what is covered, what is unresolved, and which evidence is still missing before a release decision.",
  },
] as const;

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="M4 10h11m-4-4 4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path
        d="m5 10 3 3 7-7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Home() {
  return (
    <main className="overflow-hidden bg-slate-50 text-slate-950">
      <section className="relative isolate border-b border-slate-200 bg-slate-950 px-4 py-16 text-white sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute left-[-10rem] top-[-14rem] h-[32rem] w-[32rem] rounded-full bg-cyan-400/15 blur-3xl" />
          <div className="absolute bottom-[-18rem] right-[-8rem] h-[38rem] w-[38rem] rounded-full bg-blue-500/15 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:42px_42px]" />
        </div>

        <div className="mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1.02fr_0.98fr]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-cyan-200">
              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,0.85)]" />
              Evidence-backed quality for Playwright teams
            </div>

            <h1 className="mt-7 max-w-4xl text-5xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
              Playwright tests
              <span className="block text-cyan-300">proven on your real page.</span>
            </h1>

            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
              Say what to test and paste a URL. PlaywrightGen reads the page,
              writes the test, runs it in a real browser and fixes it until it
              passes &mdash; then your team reviews it, with the passing run as
              evidence, before it counts.
            </p>

            {/* A plain GET form: it works before any script loads, and lands in
                Quick Generate with the loop already running. */}
            <form action="/generator" method="get" className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-3 sm:p-4">
              <input type="hidden" name="prove" value="1" />
              <label className="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                What should it test?
                <input
                  name="request"
                  required
                  maxLength={2_000}
                  placeholder="A visitor adds two todos, completes one, and filters to Active"
                  className="mt-2 w-full rounded-xl border border-white/15 bg-slate-950/60 px-4 py-3 text-sm font-normal normal-case tracking-normal text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
                />
              </label>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <label className="sr-only" htmlFor="hero-page-url">Page URL</label>
                <input
                  id="hero-page-url"
                  name="pageUrl"
                  type="url"
                  required
                  maxLength={2_000}
                  placeholder="https://demo.playwright.dev/todomvc/"
                  className="min-w-0 flex-1 rounded-xl border border-white/15 bg-slate-950/60 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-300"
                />
                <button
                  type="submit"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 text-sm font-bold text-slate-950 transition hover:bg-cyan-200"
                >
                  Write &amp; prove it
                  <ArrowIcon />
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Free, no account. Takes about a minute. Or{" "}
                <Link href="/generator" className="font-semibold text-cyan-200 hover:text-cyan-100">try a ready-made demo</Link>
                {" "}&middot;{" "}
                <Link href="/workspace" className="font-semibold text-cyan-200 hover:text-cyan-100">open your Workspace</Link>
              </p>
            </form>

            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-400">
              {[
                "Run in a real browser",
                "Fixed until it passes",
                "Reviewed before it counts",
              ].map((item) => (
                <span key={item} className="inline-flex items-center gap-2">
                  <span className="text-cyan-300"><CheckIcon /></span>
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-2xl lg:max-w-none">
            <div className="absolute -inset-4 rounded-[2.2rem] bg-cyan-300/10 blur-2xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-900/90 p-4 shadow-2xl shadow-black/40 backdrop-blur sm:p-6">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">
                    Quality evidence map
                  </p>
                  <p className="mt-1 text-sm text-slate-400">Illustrative project workflow</p>
                </div>
                <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-200">
                  Decision needs evidence
                </span>
              </div>

              <div className="mt-5 space-y-3">
                {[
                  ["Requirement", "Approved intent", "Version 4", "bg-emerald-300"],
                  ["Test Cases", "Linked scenarios", "Traceable", "bg-cyan-300"],
                  ["Automation", "Browser + API", "In review", "bg-blue-300"],
                  ["Run Evidence", "Immutable attempts", "Failure found", "bg-rose-300"],
                ].map(([label, detail, status, color], index) => (
                  <div key={label} className="relative">
                    {index < 3 ? (
                      <span className="absolute left-[1.15rem] top-10 h-5 w-px bg-white/10" />
                    ) : null}
                    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
                      <div>
                        <p className="text-sm font-semibold text-white">{label}</p>
                        <p className="mt-0.5 text-xs text-slate-400">{detail}</p>
                      </div>
                      <span className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-slate-300">
                        {status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-300/[0.07] p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-rose-200">
                      Highest-value action
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-200">
                      Review the failed run and its evidence before approving the
                      automation or making a release decision.
                    </p>
                  </div>
                  <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-rose-300/10 text-rose-200">
                    <ArrowIcon />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="product" className="scroll-mt-24 px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">
              One product, two ways to start
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.045em] text-slate-950 sm:text-5xl">
              Explore freely. Build trust in Workspace.
            </h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              Free tools help you reach a useful first result quickly. Workspace
              turns that one-time result into versioned, reviewable project evidence.
            </p>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Free tools</p>
                  <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
                    Fast, preliminary analysis
                  </h3>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  No project history
                </span>
              </div>
              <p className="mt-4 leading-7 text-slate-600">
                Use a focused tool when you want a disposable draft or a quick
                second opinion. These results do not claim durable project coverage.
              </p>
              <div className="mt-7 space-y-3">
                {freeTools.map((tool) => (
                  <Link
                    key={tool.href}
                    href={tool.href}
                    className="group flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-cyan-300 hover:bg-cyan-50/60"
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-xs font-bold text-cyan-700 shadow-sm">
                        {tool.number}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-slate-950">{tool.title}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{tool.action}</p>
                      </div>
                    </div>
                    <span className="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-cyan-700">
                      <ArrowIcon />
                    </span>
                  </Link>
                ))}
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[2rem] bg-slate-950 p-6 text-white shadow-xl sm:p-8">
              <div className="pointer-events-none absolute right-[-8rem] top-[-8rem] h-72 w-72 rounded-full bg-cyan-400/15 blur-3xl" />
              <div className="relative">
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-300">Workspace</p>
                    <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
                      The system of record for quality
                    </h3>
                  </div>
                  <span className="w-fit rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-semibold text-cyan-200">
                    Durable team workflow
                  </span>
                </div>
                <p className="mt-5 max-w-2xl leading-7 text-slate-300">
                  Use Workspace when evidence must survive beyond one prompt: assign
                  ownership, preserve versions, review automation, record execution,
                  and keep every decision inside the correct organization and project.
                </p>

                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  {workspaceCapabilities.map((capability) => (
                    <div
                      key={capability}
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-sm text-slate-200"
                    >
                      <span className="text-cyan-300"><CheckIcon /></span>
                      {capability}
                    </div>
                  ))}
                </div>

                <Link
                  href="/workspace"
                  className="mt-8 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-slate-950 transition hover:bg-cyan-100"
                >
                  Enter Workspace
                  <ArrowIcon />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:gap-16">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">
                The quality evidence loop
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
                From approved intent to an explainable release decision
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                Each stage produces a record the next stage can reference. Nothing
                important has to live only in a chat transcript or a copied code block.
              </p>
            </div>

            <div className="space-y-3">
              {evidenceFlow.map((item, index) => (
                <div
                  key={item.step}
                  className="group grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:border-cyan-300 hover:bg-white sm:grid-cols-[auto_1fr_auto] sm:items-center"
                >
                  <div className="flex items-center gap-3 sm:block">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-950 text-xs font-bold text-white">
                      {item.step}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-[0.14em] text-cyan-700 sm:mt-2 sm:block">
                      {item.label}
                    </span>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold tracking-[-0.02em] text-slate-950">{item.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{item.description}</p>
                  </div>
                  <div className="flex items-center gap-3 sm:flex-col sm:items-end">
                    <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                      {item.status}
                    </span>
                    {index < evidenceFlow.length - 1 ? (
                      <span className="hidden rotate-90 text-slate-300 sm:block"><ArrowIcon /></span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">
              Works where your team already works
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
              Your editor writes the code. PlaywrightGen keeps the proof.
            </h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">
              Every editor now has an assistant that writes Playwright. What it
              cannot know is which behaviour your team agreed on, and whether the
              last run proved it. That is what PlaywrightGen gives it.
            </p>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {integrations.map((integration) => (
              <div
                key={integration.label}
                className="flex flex-col rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm"
              >
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">
                  {integration.label}
                </p>
                <h3 className="mt-4 text-xl font-semibold tracking-[-0.025em] text-slate-950">
                  {integration.title}
                </h3>
                <p className="mt-3 flex-1 leading-7 text-slate-600">{integration.description}</p>
                <p className="mt-6 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs font-medium text-slate-500">
                  {integration.detail}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-6 overflow-hidden rounded-[1.75rem] border border-slate-800 bg-slate-950 p-5 font-mono text-[13px] leading-6 text-slate-300 shadow-xl sm:p-7">
            <p className="text-slate-500"># In VS Code, Cursor or Claude Code</p>
            <p className="mt-2">
              <span className="text-cyan-300">you</span> Using PlaywrightGen, write the test for our checkout test case.
            </p>
            <p className="mt-2">
              <span className="text-emerald-300">assistant</span> Read &ldquo;Customer completes checkout&rdquo; &mdash;
              approved, version 3, 4 steps. Writing{" "}
              <span className="text-slate-100">tests/customer-completes-checkout.spec.ts</span> with the title{" "}
              <span className="text-amber-200">[pwg:7c1e&hellip;]</span> so your CI results attach to version 3.
            </p>
          </div>
        </div>
      </section>

      <section className="px-4 pb-20 sm:px-6 lg:px-8 lg:pb-28">
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">
              Designed for the whole delivery conversation
            </p>
            <h2 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
              One shared view of quality, different decisions for each role
            </h2>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {audiences.map((audience, index) => (
              <div key={audience.role} className="rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-50 text-xs font-bold text-cyan-700">
                  0{index + 1}
                </span>
                <h3 className="mt-6 text-xl font-semibold tracking-[-0.025em]">{audience.role}</h3>
                <p className="mt-3 leading-7 text-slate-600">{audience.outcome}</p>
              </div>
            ))}
          </div>

          <div className="mt-20 rounded-[2.25rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8 lg:p-10">
            <div className="grid gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Trust model</p>
                <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
                  AI assistance without invisible authority
                </h2>
                <p className="mt-5 leading-7 text-slate-600">
                  The goal is not maximum automation at any cost. The goal is
                  faster quality work that remains reviewable, attributable, and
                  safe to challenge.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                {principles.map((principle) => (
                  <div key={principle.title} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                    <span className="mb-5 block h-1.5 w-12 rounded-full bg-cyan-400" />
                    <h3 className="font-semibold text-slate-950">{principle.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-600">{principle.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 pb-20 sm:px-6 lg:px-8 lg:pb-28">
        <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[2.25rem] bg-slate-950 px-6 py-12 text-white shadow-xl sm:px-10 sm:py-14 lg:px-14">
          <div className="pointer-events-none absolute right-[-8rem] top-[-10rem] h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="relative flex flex-col justify-between gap-9 lg:flex-row lg:items-end">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">Start with the evidence you have</p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
                Turn the next quality question into a durable team decision.
              </h2>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-300">
                Try a focused free review, or enter Workspace when the result needs
                ownership, history, approval, and project context.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
              <Link
                href="/workspace"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 text-sm font-bold text-slate-950 transition hover:bg-cyan-200"
              >
                Open Workspace
                <ArrowIcon />
              </Link>
              <Link
                href="/generator"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                Try Quick Generate
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
