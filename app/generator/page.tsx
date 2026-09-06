"use client";

import { useMemo, useRef, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

import { GenerationProgress } from "@/components/free-tools/generation-progress";
import { ResultActions } from "@/components/free-tools/result-actions";
import { WorkspaceHandoffButton } from "@/components/free-tools/workspace-handoff-button";
import type { FreeToolHandoff } from "@/lib/free-tools/handoff";

type GenerationMode = "FLOW" | "MARKUP" | "COMPONENT" | "API";
type GenerationDepth = "FOCUSED" | "EXPANDED";

type QuickGenerationResult = {
  title: string;
  summary: string;
  testPlan: { scenario: string; intent: string; expectedOutcome: string }[];
  code: string;
  assumptions: string[];
  warnings: string[];
  model: string;
  validation: {
    status: "PASSED" | "WARNINGS" | "BLOCKED";
    findings: { severity: "BLOCKING" | "WARNING"; code: string; message: string }[];
  };
};

const modes: Array<{
  id: GenerationMode;
  label: string;
  description: string;
  placeholder: string;
  example: string;
}> = [
  {
    id: "FLOW",
    label: "User flow",
    description: "Start from a requirement, acceptance criteria, or behavior description.",
    placeholder: "A signed-out user can submit valid credentials and reach the dashboard. Invalid credentials show a visible error without navigating…",
    example: `A signed-in customer opens /cart with one item already added.

They click the button labelled "Place order", enter a valid test card, and submit.

Expected: an order confirmation appears containing an order number. If the card is declined, an inline error is shown and the customer stays on the checkout page.`,
  },
  {
    id: "MARKUP",
    label: "HTML or JSX",
    description: "Derive user-facing scenarios from supplied markup without inventing implementation.",
    placeholder: "Paste the relevant HTML or JSX here…",
    example: `<form aria-label="Sign in">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" required />
  <label for="password">Password</label>
  <input id="password" name="password" type="password" required />
  <p role="alert" data-testid="signin-error" hidden>Invalid email or password.</p>
  <button type="submit">Sign in</button>
</form>`,
  },
  {
    id: "COMPONENT",
    label: "Component behavior",
    description: "Describe a component contract and receive a Playwright browser-test draft.",
    placeholder: "The checkout summary updates totals when quantity changes and announces validation errors…",
    example: `Component: OrderSummary

Props: items (an array of name, quantity and unitPrice), plus currency.

Behaviour: renders one row per item and shows a Subtotal equal to the sum of quantity multiplied by unitPrice. The Checkout button is disabled when there are no items. Changing a quantity updates the Subtotal immediately, and a quantity below 1 shows a validation message announced to screen readers.`,
  },
  {
    id: "API",
    label: "API contract",
    description: "Create Playwright request-fixture tests from an endpoint contract.",
    placeholder: "POST /api/orders requires an authenticated user and valid line items. Expect 201 with an order id…",
    example: `POST /api/orders

Auth: requires a bearer token. Without one it responds 401.

Body: items, each with a sku and a quantity.

Responses:
201 with an orderId and status CONFIRMED when every sku is valid and in stock
422 with code OUT_OF_STOCK and the offending sku when one is unavailable
400 when items is empty`,
  },
];

function formatBytes(bytes: number) {
  if (bytes < 1_000) return `${bytes} B`;
  return `${(bytes / 1_000).toFixed(bytes > 100_000 ? 0 : 1)} KB`;
}

export default function QuickGeneratePage() {
  const [mode, setMode] = useState<GenerationMode>("FLOW");
  const [depth, setDepth] = useState<GenerationDepth>("FOCUSED");
  const [request, setRequest] = useState("");
  const [pageUrl, setPageUrl] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [result, setResult] = useState<QuickGenerationResult | null>(null);
  const [inputSignals, setInputSignals] = useState<string[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeMode = useMemo(
    () => modes.find((item) => item.id === mode) ?? modes[0],
    [mode],
  );

  const resetResult = () => {
    setResult(null);
    setInputSignals([]);
    setError("");
  };

  const generate = async () => {
    if (!request.trim() && files.length === 0) {
      setError("Describe the intended behavior or attach relevant evidence first.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setResult(null);

      const formData = new FormData();
      formData.set("mode", mode);
      formData.set("depth", depth);
      formData.set("request", request);
      formData.set("pageUrl", pageUrl);
      files.forEach((file) => formData.append("files", file));

      const response = await fetch("/api/quick-generate", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || "Quick Generate failed.");
        if (typeof data.remaining === "number") setRemaining(data.remaining);
        return;
      }

      setResult(data.result);
      setInputSignals(Array.isArray(data.inputSignals) ? data.inputSignals : []);
      if (typeof data.remaining === "number") setRemaining(data.remaining);
      window.requestAnimationFrame(() => document.getElementById("quick-generate-result")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch {
      setError("Quick Generate could not reach the service. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handoff: FreeToolHandoff | null = result
    ? {
        version: 1,
        source: "quick-generate",
        target: "TEST_CASE",
        createdAt: new Date().toISOString(),
        title: result.title,
        summary: [
          request.trim(),
          result.summary,
          result.testPlan.map((item, index) => `${index + 1}. ${item.scenario}: ${item.intent}`).join("\n"),
        ].filter(Boolean).join("\n\n"),
        acceptanceCriteria: result.testPlan.map((item) => item.expectedOutcome).join("\n"),
        externalReference: pageUrl.trim() || undefined,
        tags: ["quick-generate", mode.toLowerCase()],
        testType: mode === "API" ? "API" : "END_TO_END",
        notice:
          "This creates an AI-suggested Test Case draft from the preliminary plan. The generated code is not imported as trusted automation; Workspace can generate a versioned artifact only after the Test Case is completed, reviewed, and approved.",
      }
    : null;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
      <div className="mx-auto max-w-7xl">
        <section className="relative overflow-hidden rounded-[2.25rem] bg-slate-950 px-6 py-10 text-white shadow-xl sm:px-9 sm:py-12 lg:px-12">
          <div className="pointer-events-none absolute right-[-8rem] top-[-10rem] h-80 w-80 rounded-full bg-cyan-400/20 blur-3xl" />
          <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">Free Tool · Quick Generate</p>
              <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.05em] sm:text-5xl lg:text-6xl">
                Turn test intent into a reviewable Playwright draft
              </h1>
              <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-300">
                Supply the behavior and evidence you actually have. PlaywrightGen returns a test plan, executable draft, assumptions, and deterministic safety checks—without claiming the code ran or passed.
              </p>
            </div>
            <div className="grid gap-2 text-sm text-slate-300">
              {["Structured output", "Evidence limitations shown", "No automatic approval"].map((item) => (
                <span key={item} className="flex items-center gap-2"><span className="text-cyan-300">✓</span>{item}</span>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">1 · Choose the evidence shape</p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {modes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { setMode(item.id); resetResult(); }}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition ${mode === item.id ? "border-slate-950 bg-slate-950 text-white shadow-sm" : "border-slate-200 bg-slate-50 hover:border-cyan-300 hover:bg-cyan-50"}`}
                >
                  <span className={`text-sm font-semibold ${mode === item.id ? "text-white" : "text-slate-950"}`}>{item.label}</span>
                  <span className={`mt-1 block text-xs leading-5 ${mode === item.id ? "text-slate-300" : "text-slate-500"}`}>{item.description}</span>
                </button>
              ))}
            </div>

            <div className="mt-6 border-t border-slate-200 pt-6">
              <p className="text-sm font-semibold text-slate-900">Draft depth</p>
              <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1">
                {(["FOCUSED", "EXPANDED"] as const).map((item) => (
                  <button key={item} type="button" onClick={() => { setDepth(item); resetResult(); }} className={`rounded-lg px-3 py-2 text-xs font-bold ${depth === item ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>
                    {item === "FOCUSED" ? "Focused" : "Expanded"}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {depth === "FOCUSED" ? "Smallest high-value suite for a fast starting point." : "Adds distinct negative and edge scenarios when evidence supports them."}
              </p>
            </div>
          </div>

          <div className="mt-7 border-t border-slate-200 pt-7">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">2 · Supply intent and evidence</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">{activeMode.label}</h2>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-semibold text-slate-800">
                Behavior, requirement, or contract
              </span>
              {/* A blank textarea is the single biggest reason someone leaves
                  without trying the product. One click should show them what
                  good input looks like and what comes back. */}
              <button
                type="button"
                onClick={() => { setRequest(activeMode.example); resetResult(); }}
                className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800 transition hover:border-cyan-300 hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
              >
                Use an example
              </button>
            </div>
            <label className="block text-sm font-semibold text-slate-800">
              <span className="sr-only">Behavior, requirement, or contract</span>
              <textarea
                rows={9}
                value={request}
                onChange={(event) => { setRequest(event.target.value); resetResult(); }}
                maxLength={30_000}
                placeholder={activeMode.placeholder}
                className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm leading-6 outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100"
              />
            </label>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-800">
                Page or API URL <span className="font-normal text-slate-400">(context only)</span>
                <input value={pageUrl} onChange={(event) => { setPageUrl(event.target.value); resetResult(); }} maxLength={2_000} placeholder="https://app.example.com/login" className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-cyan-600" />
              </label>
              <div>
                <p className="text-sm font-semibold text-slate-800">Files or screenshots <span className="font-normal text-slate-400">(optional)</span></p>
                <button type="button" onClick={() => fileInputRef.current?.click()} className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-dashed border-cyan-300 bg-cyan-50 px-4 text-sm font-semibold text-cyan-800 hover:bg-cyan-100">
                  Add evidence files
                </button>
                <input ref={fileInputRef} type="file" multiple accept="image/png,image/jpeg,image/webp,.ts,.tsx,.js,.jsx,.json,.md,.txt,.html,.css,.yml,.yaml" className="hidden" onChange={(event) => { setFiles(Array.from(event.target.files ?? []).slice(0, 6)); resetResult(); }} />
              </div>
            </div>

            {files.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {files.map((file, index) => (
                  <span key={`${file.name}-${index}`} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600">
                    {file.name} · {formatBytes(file.size)}
                    <button type="button" aria-label={`Remove ${file.name}`} onClick={() => { setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index)); resetResult(); }} className="font-bold text-slate-400 hover:text-red-600">×</button>
                  </span>
                ))}
              </div>
            ) : null}

            {error ? <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

            <div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-slate-500">
                {remaining === null ? "Up to 5 successful drafts per day." : `${remaining} successful draft${remaining === 1 ? "" : "s"} remaining today.`}
              </p>
              <button type="button" onClick={generate} disabled={loading} className="inline-flex min-h-12 items-center justify-center rounded-xl bg-slate-950 px-6 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? "Building structured draft…" : "Generate Playwright draft"}
              </button>
            </div>
          </div>
        </section>

        {loading ? (
          <GenerationProgress
            message="Building a structured Playwright draft"
            steps={[
              "Reading the behaviour, evidence, and any files you attached",
              "Planning scenarios before writing any code",
              "Generating TypeScript with role and label based locators",
              "Running deterministic checks for unsafe patterns and weak assertions",
            ]}
          />
        ) : result ? (
          <section id="quick-generate-result" className="scroll-mt-24 mt-8 space-y-6">
            <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Preliminary result</p>
                  <h2 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-slate-950">{result.title}</h2>
                  <p className="mt-3 max-w-3xl leading-7 text-slate-600">{result.summary}</p>
                </div>
                <span className={`w-fit rounded-full border px-3 py-1 text-xs font-bold ${result.validation.status === "PASSED" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : result.validation.status === "WARNINGS" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-red-200 bg-red-50 text-red-800"}`}>
                  Deterministic checks: {result.validation.status.toLowerCase()}
                </span>
              </div>

              <div className="mt-7 grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <h3 className="font-semibold text-slate-950">Test plan</h3>
                  <ol className="mt-4 space-y-4">
                    {result.testPlan.map((item, index) => (
                      <li key={`${item.scenario}-${index}`} className="grid grid-cols-[auto_1fr] gap-3">
                        <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-950 text-xs font-bold text-white">{index + 1}</span>
                        <div><p className="text-sm font-semibold text-slate-900">{item.scenario}</p><p className="mt-1 text-sm leading-6 text-slate-600">{item.intent}</p><p className="mt-1 text-xs font-medium text-cyan-800">Expected: {item.expectedOutcome}</p></div>
                      </li>
                    ))}
                  </ol>
                </div>
                <div className="space-y-4">
                  <EvidenceList title="Input signals used" items={inputSignals} empty="Only the typed request was available." tone="cyan" />
                  <EvidenceList title="Assumptions to verify" items={result.assumptions} empty="No additional assumptions returned." tone="amber" />
                  <EvidenceList title="Warnings" items={[...result.warnings, ...result.validation.findings.map((item) => item.message)]} empty="No warnings returned by the model or deterministic checks." tone="rose" />
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-950 shadow-xl">
              <div className="flex flex-col justify-between gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center">
                <div><p className="text-sm font-semibold text-white">Playwright TypeScript draft</p><p className="mt-1 text-xs text-slate-400">Generated, not executed · Review before use</p></div>
                <ResultActions content={result.code} filename="playwright-draft.spec.ts" tone="dark" />
              </div>
              <SyntaxHighlighter language="typescript" style={vscDarkPlus} customStyle={{ margin: 0, padding: "1.5rem", background: "#020617", fontSize: "0.82rem", minHeight: "18rem" }} wrapLongLines>{result.code}</SyntaxHighlighter>
            </div>

            <div className="rounded-[2rem] border border-cyan-200 bg-cyan-50 p-6 sm:p-8">
              <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
                <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-800">Need a trusted artifact?</p><h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">Continue through Test Case review in Workspace</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">The preliminary plan becomes an AI-suggested draft—not approved code. Complete the test intent, review it, approve its immutable version, then generate a versioned Browser or API artifact.</p></div>
                {handoff ? <WorkspaceHandoffButton handoff={handoff} className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-bold text-white hover:bg-cyan-700 lg:w-auto">Continue in Workspace →</WorkspaceHandoffButton> : null}
              </div>
            </div>
          </section>
        ) : (
          /* Previously this rendered nothing, so a first-time visitor saw a form
             and then blank space, with no idea what came back or whether it was
             worth the effort. Stating the shape of the output up front is the
             cheapest way to earn the first attempt. */
          <section className="mt-8 rounded-[2rem] border border-dashed border-slate-300 bg-white p-6 sm:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              What you get back
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
              A reviewable draft, not a black box
            </h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {[
                ["A test plan", "Each scenario with its intent and the outcome it expects, so you can judge the thinking before reading any code."],
                ["Runnable Playwright code", "TypeScript using @playwright/test, with role and label based locators rather than brittle selectors."],
                ["Assumptions it had to make", "Anything not in your input is listed rather than invented — no imagined URLs, selectors, or credentials."],
                ["Warnings and checks", "Deterministic checks run locally over the output, so weak assertions and unsafe patterns are flagged."],
              ].map(([title, detail]) => (
                <div key={title} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
                  <p className="mt-1.5 text-xs leading-5 text-slate-600">{detail}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-xs leading-5 text-slate-500">
              Nothing is stored and nothing is executed. This is a disposable
              starting point; turning it into evidence your team can rely on
              happens in Workspace, where intent is reviewed and approved first.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

function EvidenceList({ title, items, empty, tone }: { title: string; items: string[]; empty: string; tone: "cyan" | "amber" | "rose" }) {
  const tones = { cyan: "border-cyan-200 bg-cyan-50 text-cyan-900", amber: "border-amber-200 bg-amber-50 text-amber-900", rose: "border-rose-200 bg-rose-50 text-rose-900" };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length ? <ul className="mt-3 space-y-2 text-xs leading-5">{items.map((item, index) => <li key={`${item}-${index}`} className="flex gap-2"><span>•</span><span>{item}</span></li>)}</ul> : <p className="mt-2 text-xs leading-5 opacity-75">{empty}</p>}
    </div>
  );
}
