/**
 * Every workspace page, measured at phone width.
 *
 * A page wider than the screen slides sideways under the thumb, and nothing in
 * the test suite notices: the review pages carried that fault for weeks because
 * a long URL in a heading and a CSS grid with no column rule only misbehave
 * below 400px. This walks the signed-in workspace at 390px and fails when a
 * page is wider than the viewport, naming the box whose content overflows.
 *
 *   npm run audit:phone                      # against http://localhost:3000
 *   AUDIT_BASE_URL=https://staging… npm run audit:phone
 *
 * It signs in with a Clerk sign-in ticket, so it needs a development Clerk
 * secret (CLERK_SECRET_KEY, from .env.local) and the email of a member who can
 * see a project (AUDIT_EMAIL, or the first person the workspace lists).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

const BASE = (process.env.AUDIT_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const WIDTH = Number(process.env.AUDIT_WIDTH ?? 390);
const HEIGHT = Number(process.env.AUDIT_HEIGHT ?? 844);

function loadEnvironment() {
  const values = { ...process.env };
  try {
    for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (match && !values[match[1]]) values[match[1]] = match[2].replace(/^"|"$/g, "");
    }
  } catch {
    // No .env.local: the environment must already carry the secret.
  }
  return values;
}

async function clerk(environment, method, path, body) {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${environment.CLERK_SECRET_KEY}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Clerk ${method} ${path} failed: ${response.status}`);
  return response.json();
}

/** The widest box whose own content does not fit, which is what pushes the page. */
const OVERFLOWING = () => {
  const culprits = [];
  for (const element of document.querySelectorAll("body, body *")) {
    if (getComputedStyle(element).overflowX !== "visible" || element.clientWidth === 0) continue;
    if (element.scrollWidth <= element.clientWidth + 1) continue;
    const child = [...element.children].find(
      (candidate) => candidate.scrollWidth > candidate.clientWidth + 1 && getComputedStyle(candidate).overflowX === "visible",
    );
    if (!child) {
      const name = `${element.tagName.toLowerCase()}.${String(element.className).split(" ").slice(0, 3).join(".")}`;
      culprits.push(`${name} (${element.clientWidth}px shows ${element.scrollWidth}px) "${(element.textContent ?? "").trim().slice(0, 40)}"`);
    }
  }
  return { pageWidth: document.documentElement.scrollWidth, viewport: window.innerWidth, culprits: culprits.slice(0, 3) };
};

const PROJECT_TABS = [
  "overview",
  "health",
  "requirements",
  "test-cases",
  "cover",
  "automation",
  "test-runs",
  "release",
  "release/report",
  "reviews",
  "quality",
  "repositories",
  "activity",
  "team",
];

async function main() {
  const environment = loadEnvironment();
  if (!environment.CLERK_SECRET_KEY) throw new Error("CLERK_SECRET_KEY is required (put it in .env.local).");
  if (BASE.includes("localhost") && !environment.CLERK_SECRET_KEY.startsWith("sk_test_")) {
    throw new Error("Refusing to sign in to a local server with a production Clerk key.");
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  // jsdelivr intermittently 404s the unpinned "@clerk/ui@1"; the pinned build works.
  await context.route(/cdn\.jsdelivr\.net\/npm\/@clerk\/ui@1\//, (route) =>
    route.continue({ url: route.request().url().replace("@clerk/ui@1/", "@clerk/ui@1.33.0/") }),
  );
  const page = await context.newPage();
  const failures = [];
  const checked = [];

  try {
    const email =
      process.env.AUDIT_EMAIL ??
      (await clerk(environment, "GET", "/users?limit=1"))[0]?.email_addresses?.[0]?.email_address;
    if (!email) throw new Error("No user to sign in as; set AUDIT_EMAIL.");
    const [user] = await clerk(environment, "GET", `/users?email_address=${encodeURIComponent(email)}`);
    const ticket = await clerk(environment, "POST", "/sign_in_tokens", { user_id: user.id, expires_in_seconds: 600 });
    await page.goto(`${BASE}/sign-in?__clerk_ticket=${ticket.token}`, { waitUntil: "domcontentloaded" });
    // The ticket is consumed by Clerk in the browser; wait for the session.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await page.waitForTimeout(2_500);
      await page.goto(`${BASE}/workspace`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1_500);
      if (!/sign-in/.test(page.url())) break;
    }
    if (/sign-in/.test(page.url())) throw new Error(`Could not sign in as ${email}; is the Clerk key for this server?`);
    const projectHref = await page
      .locator("a[href*='/projects/']")
      .first()
      .getAttribute("href")
      .catch(() => null);
    if (!projectHref) throw new Error(`No project visible to ${email}; the audit needs one.`);
    const projectBase = new URL(projectHref, page.url()).toString().replace(/\/(health|quality|overview)$/, "");
    const organizationBase = projectBase.replace(/\/projects\/.*$/, "");

    const pages = [
      ["workspace home", organizationBase],
      ["billing", `${organizationBase}/billing`],
      ["new project", `${organizationBase}/projects/new`],
      ...PROJECT_TABS.map((tab) => [tab, `${projectBase}/${tab}`]),
    ];

    for (const [name, url] of pages) {
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1_200);
      const report = await page.evaluate(OVERFLOWING);
      const wide = report.pageWidth > report.viewport;
      checked.push(name);
      const status = response?.status() ?? 0;
      if (status >= 400) {
        failures.push(`${name}: HTTP ${status}`);
        console.log(`FAIL ${name.padEnd(16)} HTTP ${status}`);
        continue;
      }
      console.log(
        `${wide ? "WIDE" : "ok  "} ${name.padEnd(16)} ${report.pageWidth}px${wide ? `  <- ${report.culprits.join(" | ")}` : ""}`,
      );
      if (wide) failures.push(`${name}: ${report.pageWidth}px wide at ${WIDTH}px — ${report.culprits.join(" | ")}`);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  console.log(`\n${checked.length} pages measured at ${WIDTH}px; ${failures.length} wider than the screen.`);
  if (failures.length) {
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

await main();
