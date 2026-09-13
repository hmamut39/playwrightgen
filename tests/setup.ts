import { config as loadEnv } from "dotenv";
import { afterEach, vi } from "vitest";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

// .env.local holds a real development Clerk key. Workspace recovery would
// otherwise call Clerk for the made-up users and organizations tests create;
// tests that exercise recovery inject their own fetcher instead.
process.env.PLAYWRIGHTGEN_DISABLE_CLERK_RECOVERY = "1";

afterEach(() => {
  vi.restoreAllMocks();
});
