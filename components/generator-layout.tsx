"use client";

import { useState, type ReactNode, type ChangeEvent, type RefObject } from "react";
import GeneratorSidebar from "./generator-sidebar";

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

type SidebarHistoryItem = {
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

type SidebarProps = {
  historyItems: SidebarHistoryItem[];
  selectedHistoryId: string | null;
  onSelect: (item: SidebarHistoryItem) => void;
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

type Props = {
  children: ReactNode;
  sidebarProps: SidebarProps;
};

export default function GeneratorLayout({
  children,
  sidebarProps,
}: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#fafafa] text-black">
      <div className="flex min-h-screen">
        <div className="hidden lg:sticky lg:top-0 lg:block lg:h-screen lg:shrink-0">
          <GeneratorSidebar {...sidebarProps} />
        </div>

        {sidebarOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setSidebarOpen(false)}
            />

            <div className="relative z-50 h-full w-[20rem] max-w-[86vw] bg-white shadow-xl">
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="absolute right-5 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-300 bg-white text-lg shadow-sm transition hover:bg-gray-50"
                aria-label="Close sidebar"
                title="Close sidebar"
              >
                ✕
              </button>

              <GeneratorSidebar {...sidebarProps} />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="shrink-0 px-4 pt-4 lg:hidden">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-gray-300 bg-white text-lg shadow-sm transition hover:bg-gray-50"
                aria-label="Open sidebar"
                title="Open sidebar"
              >
                ☰
              </button>
            )}
          </div>

          <div className="flex-1 px-4 pb-6 pt-2 sm:px-6 lg:px-8 lg:pt-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}