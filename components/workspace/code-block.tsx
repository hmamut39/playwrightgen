"use client";

import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
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
 * `PrismLight` with four languages registered, not `Prism`.
 *
 * The full build carries every language Prism knows -- Fortran, Verilog,
 * Haskell, MATLAB -- and it landed in the bundle every page shares, so a
 * visitor reading the pricing page downloaded 626kB of syntax definitions for
 * languages this product never shows. It renders TypeScript, JSON and a shell
 * line; javascript is registered because TypeScript's definition extends it.
 *
 * A client component because the highlighter runs in the browser, while the
 * pages that need it are server components.
 */
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("bash", bash);

export function CodeBlock({
  code,
  language = "typescript",
  maxHeight = "46rem",
  minHeight,
  fontSize = "0.75rem",
  padding = "1.25rem",
  wrapLongLines = false,
}: {
  code: string;
  language?: string;
  maxHeight?: string;
  minHeight?: string;
  fontSize?: string;
  padding?: string;
  wrapLongLines?: boolean;
}) {
  return (
    <SyntaxHighlighter
      language={language}
      style={vscDarkPlus}
      wrapLongLines={wrapLongLines}
      customStyle={{
        margin: 0,
        padding,
        background: "#020617",
        borderRadius: "0.75rem",
        fontSize,
        lineHeight: "1.5rem",
        maxHeight,
        ...(minHeight ? { minHeight } : {}),
        overflow: "auto",
      }}
    >
      {code}
    </SyntaxHighlighter>
  );
}
