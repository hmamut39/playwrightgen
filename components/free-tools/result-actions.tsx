"use client";

import { useState } from "react";

export function ResultActions({
  content,
  filename,
  tone = "light",
  copyLabel = "Copy",
  downloadLabel = "Download",
  showDownload = true,
}: {
  content: string;
  filename: string;
  tone?: "light" | "dark";
  copyLabel?: string;
  downloadLabel?: string;
  /**
   * A generated test is worth keeping as a file; a ten-line editor config is
   * not -- it is going straight into a settings file somebody already has
   * open. The MCP page needs the copying and not the download.
   */
  showDownload?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const buttonStyle =
    tone === "dark"
      ? "border-white/15 text-white hover:bg-white/10"
      : "border-slate-300 bg-white text-slate-700 hover:border-cyan-300 hover:bg-cyan-50";

  async function copy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  function download() {
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-wrap gap-2" aria-label="Result actions">
      <button
        type="button"
        onClick={copy}
        className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${buttonStyle}`}
      >
        {copied ? "Copied" : copyLabel}
      </button>
      {showDownload ? (
        <button
          type="button"
          onClick={download}
          className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${buttonStyle}`}
        >
          {downloadLabel}
        </button>
      ) : null}
    </div>
  );
}
