"use client";

import { useMemo, useState, type ChangeEvent, type RefObject } from "react";
import { formatDateLabel } from "@/utils/date";

type Mode = "text" | "html" | "api" | "component";
type StyleMode = "fast" | "clean" | "production";
type OutputType = "playwright" | "unit";
type TabType = "generate" | "debug";

type IssueType =
  | "Smart Detect"
  | "Test Failure"
  | "UI/Layout"
  | "Component Logic"
  | "Styling"
  | "General Bug";

type HistoryItem = {
  id: string;
  mode: Mode;
  prompt: string;
  url: string;
  generatedCode: string;
  createdAt: string;
  styleMode: StyleMode;
  outputType: OutputType;
  generationType: "prompt" | "url";
  tabType?: TabType;
  issueType?: IssueType;
};

type Props = {
  historyItems: HistoryItem[];
  selectedHistoryId: string | null;
  onSelect: (item: HistoryItem) => void;
  onNew: () => void;
  onClear: () => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
  userEmail: string;
  isProVerified: boolean;
  remainingGenerations: number;
  hasSyncedUsage: boolean;
  freeDailyGenerations: number;
  uploadedFiles: File[];
  onFileUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (index: number) => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

export default function GeneratorSidebar({
  historyItems,
  selectedHistoryId,
  onSelect,
  onNew,
  onClear,
  onDelete,
  onLogout,
  userEmail,
  isProVerified,
  remainingGenerations,
  hasSyncedUsage,
  freeDailyGenerations,
}: Props) {
  const [search, setSearch] = useState("");

  const filteredHistoryItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return historyItems;

    return historyItems.filter((item) => {
      return (
        (item.prompt || "").toLowerCase().includes(q) ||
        (item.url || "").toLowerCase().includes(q) ||
        (item.generatedCode || "").toLowerCase().includes(q) ||
        (item.mode || "").toLowerCase().includes(q) ||
        (item.tabType || "").toLowerCase().includes(q)
      );
    });
  }, [historyItems, search]);

  return (
    <aside className="flex h-full w-[19rem] flex-col border-r border-gray-200 bg-white pt-4 lg:h-screen lg:w-[290px] lg:pt-0">
      <div className="border-b border-gray-200 px-4 py-4">
        <div className="text-lg font-semibold text-black">PlaywrightGen</div>
        <div className="text-xs text-gray-500">AI test workspace</div>
      </div>

      <div className="space-y-3 border-b border-gray-200 p-4">
        <button
          type="button"
          onClick={onNew}
          className="w-full rounded-xl bg-black px-4 py-3 text-sm font-medium text-white transition hover:opacity-90"
        >
          + New generation
        </button>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search history"
          className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-black"
        />
      </div>

      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div>
          <div className="text-sm font-medium text-black">History</div>
          <div className="text-xs text-gray-500">
            {filteredHistoryItems.length} item{filteredHistoryItems.length === 1 ? "" : "s"}
          </div>
        </div>

        {historyItems.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-gray-500 transition hover:text-black"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="space-y-2">
          {filteredHistoryItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-400">
              No saved history yet.
            </div>
          ) : (
            filteredHistoryItems.map((item) => (
              <div
                key={item.id}
                className={`flex items-start gap-2 rounded-2xl border p-3 transition ${
                  selectedHistoryId === item.id
                    ? "border-black bg-black text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[11px] font-medium uppercase tracking-[0.14em] opacity-70">
                      {item.tabType === "debug"
                        ? "debug"
                        : item.generationType === "url"
                        ? "analyze"
                        : item.mode}
                    </span>

                    <span className="shrink-0 text-[11px] opacity-70">
                      {formatDateLabel(item.createdAt)}
                    </span>
                  </div>

                  <p className="mt-2 truncate text-sm font-medium leading-5">
                    {item.generationType === "url"
                      ? item.url || "Page analysis"
                      : item.prompt || "Generated output"}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(item.id);
                  }}
                  className={`mt-1 shrink-0 rounded-md p-2 transition ${
                    selectedHistoryId === item.id
                      ? "text-white/70 hover:bg-white/10 hover:text-white"
                      : "text-gray-400 hover:bg-gray-100 hover:text-red-500"
                  }`}
                  aria-label="Delete history item"
                  title="Delete"
                >
                  🗑️
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="space-y-3 border-t border-gray-200 bg-white p-4">
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
          <div className="text-xs uppercase tracking-[0.16em] text-gray-400">
            Plan
          </div>
          <div className="mt-1 text-sm font-medium text-black">
            {isProVerified ? "Pro active" : "Free plan"}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {isProVerified
              ? "Unlimited Pro workflow access"
              : hasSyncedUsage
              ? `${remainingGenerations} of ${freeDailyGenerations} generations left today`
              : `${freeDailyGenerations} generations per day`}
          </div>
        </div>

        {userEmail && (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
            Signed in as:
            <div className="mt-1 break-all font-medium text-black">{userEmail}</div>
          </div>
        )}

        <button
          type="button"
          onClick={onLogout}
          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-black hover:text-black"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}
