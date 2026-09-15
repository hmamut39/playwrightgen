import { z } from "zod";

export const FREE_TOOL_HANDOFF_STORAGE_KEY = "playwrightgen:free-tool-handoff:v1";

export const freeToolHandoffSchema = z.object({
  version: z.literal(1),
  source: z.enum(["quick-generate", "coverage-review", "release-review"]),
  target: z.enum(["TEST_CASE", "REQUIREMENT"]),
  createdAt: z.string().datetime(),
  title: z.string().trim().min(1).max(300),
  summary: z.string().trim().max(50_000),
  acceptanceCriteria: z.string().trim().max(50_000),
  /** Test Case steps, one per item, when the tool produced a plan. */
  steps: z.array(z.string().trim().min(1).max(2_000)).max(50).optional(),
  externalReference: z.string().trim().max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20),
  testType: z
    .enum(["FUNCTIONAL", "END_TO_END", "API", "INTEGRATION", "REGRESSION"])
    .optional(),
  notice: z.string().trim().max(2_000),
  /** Playwright code that comes along with a Test Case, and the signed receipt of its last live run. */
  draft: z
    .object({
      code: z.string().min(1).max(100_000),
      pageUrl: z.string().trim().max(2_000).optional(),
      receipt: z.string().max(4_000).optional(),
    })
    .optional(),
});

/** What a receipt says, for display only; the server checks the signature on import. */
export function peekRunReceipt(receipt: string | undefined): { verdict: "passed" | "partial" | "failed"; passed: number; ranAt: string } | null {
  const body = receipt?.split(".")[1];
  if (!body) return null;
  try {
    const text = atob(body.replace(/-/g, "+").replace(/_/g, "/"));
    const value = JSON.parse(text) as { verdict?: unknown; passed?: unknown; ranAt?: unknown };
    if (
      (value.verdict === "passed" || value.verdict === "partial" || value.verdict === "failed") &&
      typeof value.passed === "number" &&
      typeof value.ranAt === "string"
    ) {
      return { verdict: value.verdict, passed: value.passed, ranAt: value.ranAt };
    }
  } catch {
    // Not a receipt this page can read; the import still works without it.
  }
  return null;
}

export type FreeToolHandoff = z.infer<typeof freeToolHandoffSchema>;

export function saveFreeToolHandoff(handoff: FreeToolHandoff): void {
  const parsed = freeToolHandoffSchema.parse(handoff);
  sessionStorage.setItem(FREE_TOOL_HANDOFF_STORAGE_KEY, JSON.stringify(parsed));
}

// The import page reads the handoff through useSyncExternalStore, which
// requires the same object back while nothing has changed. Parsing afresh on
// every call returned a new object each render, and React re-rendered until it
// gave up with "Maximum update depth exceeded" -- the page never showed.
let cached: { raw: string; value: FreeToolHandoff | null } | null = null;

export function readFreeToolHandoff(): FreeToolHandoff | null {
  const raw = sessionStorage.getItem(FREE_TOOL_HANDOFF_STORAGE_KEY);
  if (!raw) return null;
  if (cached?.raw === raw) return cached.value;
  const value = parseFreeToolHandoff(raw);
  cached = { raw, value };
  return value;
}

function parseFreeToolHandoff(raw: string): FreeToolHandoff | null {
  try {
    const parsed = freeToolHandoffSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;

    const age = Date.now() - new Date(parsed.data.createdAt).getTime();
    if (!Number.isFinite(age) || age > 24 * 60 * 60 * 1_000) {
      sessionStorage.removeItem(FREE_TOOL_HANDOFF_STORAGE_KEY);
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

export function clearFreeToolHandoff(): void {
  sessionStorage.removeItem(FREE_TOOL_HANDOFF_STORAGE_KEY);
}
