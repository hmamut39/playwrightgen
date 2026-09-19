import type { Metadata } from "next";
import Link from "next/link";

import { SHARE_IMAGE, siteUrl } from "@/lib/site";

const TITLE = "Playwright MCP server for Copilot, Cursor and Claude Code";
const DESCRIPTION =
  "Connect your editor's AI assistant to PlaywrightGen over MCP: it writes Playwright tests from the real page, runs them on the live page until they pass, and proposes them for your team to review.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/mcp" },
  openGraph: { title: `${TITLE} · PlaywrightGen`, description: DESCRIPTION, images: [SHARE_IMAGE] },
  twitter: { card: "summary_large_image", images: [SHARE_IMAGE.url] },
};

/**
 * The public page for the MCP server: what an editor's assistant can do with
 * it, how to connect, and what it can never do. The connection itself needs a
 * workspace and a personal token, so this page explains and sends people to
 * sign up; it is also what MCP directories and search results point at.
 */

const loop = [
  {
    step: "1",
    title: "Write it from the real page",
    body: "generate_playwright_test opens the page in a remote browser and builds locators from its real buttons, fields and test attributes, so the first draft is not a guess.",
  },
  {
    step: "2",
    title: "Run it until it passes",
    body: "run_playwright_test replays the test step by step on the live page and returns the failing step with the page as it was, so your assistant fixes the locator and runs again. prove_playwright_test does that whole loop in one call.",
  },
  {
    step: "3",
    title: "Propose it for review",
    body: "propose_test_case sends the test case and code with a signed receipt of the passing run. A person on your team approves it; then it becomes reviewed automation.",
  },
];

const tools: Array<{ name: string; kind: "Reads" | "Runs" | "Proposes"; does: string }> = [
  { name: "prove_playwright_test", kind: "Runs", does: "The whole loop in one call: write it, run it, fix the failing step, run again until it passes." },
  { name: "plan_page_coverage", kind: "Proposes", does: "Plans the tests a whole page needs; a person approves the plan in PlaywrightGen." },
  { name: "prove_page_coverage", kind: "Runs", does: "Proves each approved test on the live page and returns the passing suite." },
  { name: "generate_playwright_test", kind: "Runs", does: "Writes a draft from a described flow and the real page." },
  { name: "run_playwright_test", kind: "Runs", does: "Replays a test on the live page; reports each step and the page at a failure." },
  { name: "propose_test_case", kind: "Proposes", does: "Creates a draft test case, optionally with code and a passing run, for review." },
  { name: "submit_playwright_code", kind: "Proposes", does: "Sends code for an existing test case, waiting for a person to use it." },
  { name: "list_test_cases", kind: "Reads", does: "Test cases with their review status and version." },
  { name: "get_test_case", kind: "Reads", does: "Approved steps, expected results and the version marker for the test title." },
  { name: "list_approved_automation", kind: "Reads", does: "Reviewed Playwright automation in the project." },
  { name: "get_approved_automation", kind: "Reads", does: "The approved code, ready to save into the repository." },
  { name: "list_recent_failures", kind: "Reads", does: "What failed in CI recently, with the failure output." },
  { name: "project_overview", kind: "Reads", does: "Release readiness: coverage, regressions and blockers." },
];

const KIND_STYLE = {
  Reads: "bg-slate-100 text-slate-700",
  Runs: "bg-cyan-50 text-cyan-800",
  Proposes: "bg-amber-50 text-amber-800",
} as const;

export default function McpPage() {
  const url = `${siteUrl()}/api/mcp`;
  const configs = [
    {
      editor: "VS Code (Copilot agent mode)",
      file: ".vscode/mcp.json",
      code: JSON.stringify(
        {
          inputs: [{ type: "promptString", id: "playwrightgen-token", description: "PlaywrightGen editor token", password: true }],
          servers: { playwrightgen: { type: "http", url, headers: { Authorization: "Bearer ${input:playwrightgen-token}" } } },
        },
        null,
        2,
      ),
    },
    {
      editor: "Cursor",
      file: "~/.cursor/mcp.json",
      code: JSON.stringify({ mcpServers: { playwrightgen: { url, headers: { Authorization: "Bearer YOUR_TOKEN" } } } }, null, 2),
    },
    {
      editor: "Claude Code",
      file: "Terminal",
      code: `claude mcp add --transport http playwrightgen ${url} --header "Authorization: Bearer YOUR_TOKEN"`,
    },
  ];

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mx-auto max-w-6xl">
        <section className="relative overflow-hidden rounded-[2.25rem] bg-slate-950 px-6 py-10 text-white shadow-xl sm:px-9 sm:py-12 lg:px-12">
          <div className="pointer-events-none absolute right-[-8rem] top-[-10rem] h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="relative">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">MCP server</p>
            <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
              Playwright tests your editor&rsquo;s AI has proven on the live page
            </h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-300">
              Connect GitHub Copilot, Cursor or Claude Code to PlaywrightGen. Your assistant writes the test from the real
              page, runs it until it passes, and proposes it with that evidence &mdash; and your team decides what counts.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/sign-up" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-cyan-400 px-6 text-sm font-bold text-slate-950 hover:bg-cyan-300">
                Create a free workspace
              </Link>
              <Link href="/generator" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/20 px-6 text-sm font-bold text-white hover:bg-white/10">
                Try it in the browser first
              </Link>
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          {loop.map((item) => (
            <div key={item.step} className="rounded-[1.5rem] border border-slate-200 bg-white p-6 shadow-sm">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-950 text-sm font-bold text-white">{item.step}</span>
              <h2 className="mt-4 text-lg font-semibold text-slate-950">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
            </div>
          ))}
        </section>

        <section className="mt-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">Tools</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Eleven tools over the Model Context Protocol (Streamable HTTP). Running and generating use your
            workspace&rsquo;s daily AI allowance.
          </p>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4 font-semibold">Tool</th>
                  <th className="py-2 pr-4 font-semibold">Kind</th>
                  <th className="py-2 font-semibold">What it does</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tools.map((tool) => (
                  <tr key={tool.name}>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-900">{tool.name}</td>
                    <td className="py-3 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_STYLE[tool.kind]}`}>{tool.kind}</span>
                    </td>
                    <td className="py-3 text-slate-600">{tool.does}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">Connect in three steps</h2>
          <ol className="mt-4 space-y-2 text-sm leading-6 text-slate-700">
            <li>
              <span className="font-semibold">1.</span> <Link href="/sign-up" className="font-semibold text-cyan-800 hover:text-cyan-950">Create a free workspace</Link> and a project.
            </li>
            <li>
              <span className="font-semibold">2.</span> Open the project&rsquo;s <span className="font-semibold">Automation</span> page and copy your personal editor token.
            </li>
            <li>
              <span className="font-semibold">3.</span> Add PlaywrightGen to your editor, replacing YOUR_TOKEN (the Automation page gives you this with your token filled in):
            </li>
          </ol>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {configs.map((config) => (
              <div key={config.editor} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-950">
                <div className="flex items-baseline justify-between gap-3 border-b border-white/10 px-4 py-3">
                  <p className="text-sm font-semibold text-white">{config.editor}</p>
                  <p className="truncate font-mono text-xs text-slate-400">{config.file}</p>
                </div>
                <pre className="overflow-x-auto p-4 text-xs leading-5 text-slate-100">{config.code}</pre>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-[2rem] border border-emerald-200 bg-emerald-50 p-6 sm:p-8">
          <h2 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">What it can never do</h2>
          <ul className="mt-4 grid gap-3 text-sm leading-6 text-slate-700 md:grid-cols-2">
            <li><span className="font-semibold">Approve anything.</span> Proposals wait for a person on your team; nothing counts as coverage until they approve it.</li>
            <li><span className="font-semibold">Go beyond your role.</span> The token is yours, for one project, and checked against your access on every request. A viewer&rsquo;s assistant cannot write.</li>
            <li><span className="font-semibold">Execute test code.</span> Runs read the test into safe Playwright steps and replay them in a remote browser, only on public pages.</li>
            <li><span className="font-semibold">Keep your test account.</span> Values for a sign-in are used for one run, never stored, and blanked out of what the run reports.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
