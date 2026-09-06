"use client";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

/**
 * Highlighted source, shared by every surface that shows generated code.
 *
 * The free Quick Generate page highlighted its output while the workspace, the
 * part people would pay for, rendered the same TypeScript as one flat colour in
 * a plain <pre>. Reviewing automation is the whole purpose of that page, and
 * unhighlighted code is materially harder to read: strings, keywords and
 * comments all look alike, so a reviewer has to parse structure by eye before
 * they can judge whether the test is any good.
 *
 * A client component because the highlighter runs in the browser, while the
 * pages that need it are server components.
 */
export function CodeBlock({
  code,
  language = "typescript",
  maxHeight = "46rem",
}: {
  code: string;
  language?: string;
  maxHeight?: string;
}) {
  return (
    <SyntaxHighlighter
      language={language}
      style={vscDarkPlus}
      customStyle={{
        margin: 0,
        padding: "1.25rem",
        background: "#020617",
        borderRadius: "0.75rem",
        fontSize: "0.75rem",
        lineHeight: "1.5rem",
        maxHeight,
        overflow: "auto",
      }}
    >
      {code}
    </SyntaxHighlighter>
  );
}
