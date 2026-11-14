import { parseArgs } from "node:util";

/**
 * Uses the deployment the way a person does, once a day, and says what broke.
 *
 * PlaywrightGen sells this sentence: daily checks run on your site and tell
 * you the day one breaks. Nothing ran them on playwrightgen.com. There were
 * two scheduled workflows -- a dependency audit and the weekly evals -- and
 * neither one opened the product.
 *
 * So on 2026-11-07 the upgrade to Playwright 1.65 moved a file the build
 * cannot see, every route that opens a browser began answering 500 with an
 * empty body, and it stayed that way for a day. CI was green throughout, and
 * correctly: CI tests the repository. Nobody was testing the deployment. It
 * was found by accident, while verifying something unrelated.
 *
 * The steps below are the chain that broke, in the order a person meets it.
 * Each one names what it proves, because "the canary failed" is the same
 * unhelpful sentence as "still failing after the automatic fixes".
 *
 *   node scripts/watch-production.mjs
 *   node scripts/watch-production.mjs --site https://playwrightgen.com
 *
 * It needs no secrets. Everything it touches is what a visitor with no
 * account can reach, which is the point: if this passes, a stranger can use
 * the product today.
 */

const { values } = parseArgs({
  options: { site: { type: "string", default: "https://playwrightgen.com" } },
});

const site = values.site.replace(/\/$/, "");

/** A test the preview runner can prove on a public page, with real assertions. */
const PROBE = [
  "import { test, expect } from '@playwright/test';",
  "",
  "test('a visitor adds a todo', async ({ page }) => {",
  "  await page.goto('https://demo.playwright.dev/todomvc/');",
  "  const box = page.getByRole('textbox', { name: 'What needs to be done?' });",
  "  await box.fill('Buy milk');",
  "  await box.press('Enter');",
  "  await expect(page.getByText('Buy milk')).toBeVisible();",
  "  await expect(box).toHaveValue('');",
  "});",
].join("\n");

/**
 * Asked twice before it counts.
 *
 * A watcher that cries wolf is turned off, and then it is worse than nothing
 * because somebody believes it is watching. One network blip at 06:00 must
 * not produce an alarm; a deployment that is actually broken fails both
 * times, because it is broken both times.
 */
async function twice(attempt) {
  const first = await attempt().catch((error) => ({ ok: false, why: String(error).slice(0, 160) }));
  if (first.ok) return first;
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const second = await attempt().catch((error) => ({ ok: false, why: String(error).slice(0, 160) }));
  return second.ok ? { ...second, flaked: first.why } : second;
}

const steps = [
  {
    name: "the site answers",
    proves: "the deployment is up and its database and dependencies report healthy",
    async run() {
      const response = await fetch(`${site}/api/health`);
      if (!response.ok) return { ok: false, why: `GET /api/health answered ${response.status}` };
      const body = await response.json();
      const unhealthy = (body.components ?? []).filter((part) => part.status && part.status !== "healthy");
      if (unhealthy.length) {
        return { ok: false, why: `unhealthy: ${unhealthy.map((part) => part.name).join(", ")}` };
      }
      return { ok: true, note: `${(body.components ?? []).length} components healthy` };
    },
  },
  {
    name: "the home page offers the worked example",
    proves: "a stranger arriving with no account is still shown something real",
    async run() {
      const response = await fetch(site, { headers: { accept: "text/html" } });
      if (!response.ok) return { ok: false, why: `GET / answered ${response.status}` };
      const html = await response.text();
      if (!html.includes("/proof/example")) return { ok: false, why: "the home page no longer links to the example" };
      return { ok: true, note: "links to /proof/example" };
    },
  },
  {
    name: "a test runs on a real page",
    proves: "the headline feature works: a browser opens, the test replays, and assertions are counted",
    async run() {
      const response = await fetch(`${site}/api/preview-run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: PROBE, pageUrl: "https://demo.playwright.dev/todomvc/" }),
      });
      // The shape of the 2026-11-07 outage: a 500 with an empty body, before
      // the handler, so there is nothing in the response to go on.
      if (!response.ok) {
        const body = (await response.text()).slice(0, 200);
        return { ok: false, why: `POST /api/preview-run answered ${response.status}${body ? `: ${body}` : " with an empty body"}` };
      }
      const data = await response.json();
      const counts = data.result?.counts;
      if (!counts) return { ok: false, why: "the run returned no counts" };
      if (counts.failed > 0) return { ok: false, why: `${counts.failed} step(s) failed on the live page` };
      // Checks, not steps. A run that performs every action and asserts
      // nothing is the failure this product exists to notice.
      if (!counts.checks) return { ok: false, why: "the run proved nothing: zero assertions held" };
      return { ok: true, note: `${counts.checks} checks over ${counts.passed} steps` };
    },
  },
  {
    name: "the public evidence page shows evidence",
    proves: "the page shared with people outside a team still loads and still has something on it",
    async run() {
      const response = await fetch(`${site}/proof/example`, { headers: { accept: "text/html" } });
      if (!response.ok) return { ok: false, why: `GET /proof/example answered ${response.status}` };
      const html = await response.text();
      if (html.includes("This link has expired") || html.includes("nothing to verify")) {
        return { ok: false, why: "the example page has nothing on it" };
      }
      if (!/Approved tests|Requirements/.test(html)) return { ok: false, why: "the example page shows no totals" };
      return { ok: true, note: "loads with totals" };
    },
  },
  {
    name: "the MCP endpoint loads",
    proves: "an assistant can still connect; it went down with the browser routes and nobody noticed",
    async run() {
      const response = await fetch(`${site}/api/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      // 401 is the right answer to an unauthenticated call: the module loaded
      // and refused. 500 means it did not load; 404 means it is not there at
      // all, which the first version of this step accepted as proof that it
      // was -- caught by pointing the watcher at a path that does not exist
      // and watching this step alone report ok.
      const loaded = [400, 401, 403, 405, 406, 415];
      if (!loaded.includes(response.status)) {
        return { ok: false, why: `POST /api/mcp answered ${response.status}, not a refusal from a loaded module` };
      }
      return { ok: true, note: `answered ${response.status}, so the module loaded and refused` };
    },
  },
];

console.log(`Using ${site} the way a person does.\n`);

const failures = [];
for (const step of steps) {
  const result = await twice(step.run);
  if (result.ok) {
    console.log(`  ok    ${step.name}${result.note ? ` -- ${result.note}` : ""}`);
    if (result.flaked) console.log(`        (first attempt failed: ${result.flaked})`);
  } else {
    console.log(`  BROKE ${step.name}`);
    console.log(`        ${result.why}`);
    console.log(`        this proves: ${step.proves}`);
    failures.push({ step, why: result.why });
  }
}

if (failures.length === 0) {
  console.log("\nEverything a stranger would touch is working.");
  process.exit(0);
}

console.log(
  `\n${failures.length} of ${steps.length} broke, twice each. ` +
    "This is the deployment, not the repository: the test suite can be green while all of it is down.",
);
process.exit(1);
