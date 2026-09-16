"use client";

export type TestAccountValue = { username: string; password: string; loginUrl: string };

export const EMPTY_TEST_ACCOUNT: TestAccountValue = { username: "", password: "", loginUrl: "" };

/** Adds the account to a free-tool request, when one was entered. */
export function appendTestAccount(formData: FormData, account: TestAccountValue) {
  if (!account.username && !account.password) return;
  formData.set("accountUsername", account.username);
  formData.set("accountPassword", account.password);
  if (account.loginUrl.trim()) formData.set("accountLoginUrl", account.loginUrl.trim());
}

/** Values for the process.env names generated sign-in steps use. */
export function testAccountEnv(account: TestAccountValue): Record<string, string> {
  return {
    ...(account.username ? { E2E_USERNAME: account.username } : {}),
    ...(account.password ? { E2E_PASSWORD: account.password } : {}),
  };
}

/**
 * "Page behind a login? Add a test account": kept in the page's memory only,
 * sent with the request and its live runs, never saved.
 */
export function TestAccountFields({ value, onChange }: { value: TestAccountValue; onChange: (value: TestAccountValue) => void }) {
  const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-600";
  return (
    <details open={Boolean(value.username || value.password)} className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-800">
        Page behind a login? <span className="font-normal text-slate-500">Add a test account</span>
      </summary>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        We sign in on the site in a remote browser and read what a signed-in person sees. Used for this request and its live
        runs only &mdash; never saved and never sent to the AI. Use a test account, not a personal one.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input aria-label="Test account username or email" autoComplete="off" value={value.username} onChange={(event) => onChange({ ...value, username: event.target.value })} maxLength={200} placeholder="Username or email" className={field} />
        <input aria-label="Test account password" type="password" autoComplete="new-password" value={value.password} onChange={(event) => onChange({ ...value, password: event.target.value })} maxLength={200} placeholder="Password" className={field} />
      </div>
      <input aria-label="Login page URL, if different" value={value.loginUrl} onChange={(event) => onChange({ ...value, loginUrl: event.target.value })} maxLength={2_000} placeholder="Login page URL (only if it is a different page)" className={`mt-2 ${field}`} />
    </details>
  );
}
