"use client";

import { useState } from "react";

import { CopyField } from "@/components/workspace/ci-setup-panel";
import { CodeBlock } from "@/components/workspace/code-block";

type Editor = "vscode" | "cursor" | "claude";

const EDITORS: Array<{ id: Editor; label: string }> = [
  { id: "vscode", label: "VS Code" },
  { id: "cursor", label: "Cursor" },
  { id: "claude", label: "Claude Code" },
];

/**
 * Connects someone's own editor to this project.
 *
 * The question was "can people use this from VS Code, or only copy and
 * download?". Rather than an extension per editor, the project is served over
 * MCP, which VS Code's agent mode, Cursor and Claude Code all speak. The
 * snippet for VS Code prompts for the token instead of embedding it, because
 * `.vscode/mcp.json` is usually committed and a token in it would be shared
 * with everyone who can read the repository.
 */
export function EditorSetupPanel({ mcpUrl, token }: { mcpUrl: string; token: string }) {
  const [editor, setEditor] = useState<Editor>("vscode");

  const [copied, setCopied] = useState(false);

  const snippets: Record<Editor, { file: string; code: string; language: string; note: string }> = {
    vscode: {
      file: ".vscode/mcp.json",
      code: JSON.stringify(
        {
          inputs: [
            {
              type: "promptString",
              id: "playwrightgen-token",
              description: "PlaywrightGen editor token",
              password: true,
            },
          ],
          servers: {
            playwrightgen: {
              type: "http",
              url: mcpUrl,
              headers: { Authorization: "Bearer ${input:playwrightgen-token}" },
            },
          },
        },
        null,
        2,
      ),
      language: "json",
      note: "Save this in your repository, open Copilot Chat in Agent mode, and paste your token when VS Code asks for it. The file holds no secret, so it is safe to commit.",
    },
    cursor: {
      file: "~/.cursor/mcp.json",
      code: JSON.stringify(
        {
          mcpServers: {
            playwrightgen: { url: mcpUrl, headers: { Authorization: `Bearer ${token}` } },
          },
        },
        null,
        2,
      ),
      language: "json",
      note: "This contains your token, so keep it in your home folder rather than the repository.",
    },
    claude: {
      file: "Terminal",
      code: `claude mcp add --transport http playwrightgen ${mcpUrl} --header "Authorization: Bearer ${token}"`,
      language: "bash",
      note: "Run once in your project folder. Claude Code keeps the token in your local settings.",
    },
  };
  const active = snippets[editor];
  // Shown masked, copied whole: the page may be on a shared screen, and the
  // snippet is only useful with the real token in it.
  const shown = active.code.split(token).join("•".repeat(12));

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(active.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard can be denied; the token field above still copies.
    }
  }

  return (
    <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">
        Your editor
      </p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight">
        Use approved tests from VS Code, Cursor or Claude Code
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
        Connect your editor&rsquo;s AI assistant to this project. It can then read
        approved test cases and write tests against them, pull approved
        automation into your repository with the version marker intact, and see
        what failed in the last run &mdash; without copy and paste. It can also
        propose new test cases and send the code it wrote, which wait for a person
        to review; it can never approve anything.
      </p>

      <div className="mt-6">
        <CopyField label="Your editor token" value={token} secret />
      </div>

      <div className="mt-6 flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Editor">
        {EDITORS.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={editor === candidate.id}
            onClick={() => setEditor(candidate.id)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
              editor === candidate.id
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-600 hover:text-slate-950"
            }`}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          {active.file}
        </p>
        <button
          type="button"
          onClick={copySnippet}
          className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-medium text-cyan-800 transition hover:border-cyan-300 hover:bg-cyan-100"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="mt-2">
        <CodeBlock code={shown} language={active.language} maxHeight="22rem" />
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-600">{active.note}</p>

      <p className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
        This token is yours alone and can do only what your role here allows.
        It stops working as soon as your access to this project ends, and
        rotating the project&rsquo;s CI token on the Repositories page also
        replaces it. Try asking your assistant: &ldquo;Using PlaywrightGen, write
        the Playwright test for our checkout test case.&rdquo;
      </p>
    </section>
  );
}
