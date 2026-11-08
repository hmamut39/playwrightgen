import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { executePreviewRun } from "@/lib/free-tools/preview-run/execute";
import { planPreviewRun } from "@/lib/free-tools/preview-run/plan";

/**
 * What the preview runner counts, measured against a real browser.
 *
 * The runner reported one number, `passed`, and the product showed it as
 * "checks" -- on the generator's result banner, on the automation page, in the
 * MCP reply an assistant reads, and in the signed receipt that travels with an
 * imported test. But it counted every operation: a `goto`, a `fill` and a
 * `press` were each a "check". A generated test with three assertions and four
 * actions said "7 checks passed" under "proven on your real page", which is
 * more than twice what it had checked.
 *
 * These tests run real code in a real browser and then compare the counts with
 * what a tester reading the same code would count. They are the only place that
 * can: the number is produced by the run, not by a pure function.
 */

const PAGE = `<!doctype html>
<html><head><title>Order a coffee</title></head>
<body>
  <h1>Order a coffee</h1>
  <label>Name <input id="name" /></label>
  <p id="status">Nothing ordered yet</p>
  <button onclick="document.getElementById('status').textContent = 'Order placed'">Place order</button>
</body></html>`;

let server: Server;
let browser: Browser;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

const run = async (code: string) =>
  executePreviewRun(planPreviewRun(code, { env: {} }), { browser, baseUrl, budgetMs: 30_000 });

describe("what the preview runner says it checked", () => {
  it("counts the assertions, not the typing and clicking that led to them", async () => {
    // Four actions and two assertions. A reader of this test would say it
    // checks two things.
    const result = await run(`import { test, expect } from '@playwright/test';

test('places an order', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Name').fill('Sam');
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.locator('#status')).toHaveText('Order placed');
  await expect(page.getByRole('heading', { name: 'Order a coffee' })).toBeVisible();
});`);

    expect(result.counts.failed).toBe(0);
    expect(result.counts.checks).toBe(2);
    // The operation total is still kept, and is still larger. Keeping both is
    // the point: one says how far the test got, the other what it proved.
    expect(result.counts.passed).toBeGreaterThan(result.counts.checks);
  }, 90_000);

  it("says nothing was checked when a test only clicks through the page", async () => {
    // This passes, and proves nothing. The product's own claim beside it has
    // to be able to say so.
    const result = await run(`import { test, expect } from '@playwright/test';

test('walks through the page', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Name').fill('Sam');
  await page.getByRole('button', { name: 'Place order' }).click();
});`);

    expect(result.counts.failed).toBe(0);
    expect(result.counts.passed).toBeGreaterThan(0);
    expect(result.counts.checks).toBe(0);
  }, 90_000);

  it("counts a failed assertion as a check that did not hold, not as a check", async () => {
    const result = await run(`import { test, expect } from '@playwright/test';

test('expects the wrong status', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('Order placed');
});`);

    expect(result.counts.failed).toBe(1);
    expect(result.counts.checks).toBe(0);
    expect(result.counts.checksFailed).toBe(1);
  }, 90_000);

  it("does not count an assertion that never ran", async () => {
    // The click fails, so the assertion after it is never reached. It is not a
    // check that held and it is not one that failed.
    const result = await run(`import { test, expect } from '@playwright/test';

test('stops before the assertion', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'No such button' }).click({ timeout: 2000 });
  await expect(page.locator('#status')).toHaveText('Order placed');
});`);

    expect(result.counts.checks).toBe(0);
    expect(result.counts.checksFailed).toBe(0);
    expect(result.counts.notReached).toBeGreaterThan(0);
  }, 90_000);
});
