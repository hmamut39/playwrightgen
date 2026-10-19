import { expect, test } from "@playwright/test";

test("public quality workflow surfaces remain reachable", async ({ page }) => {
  test.setTimeout(180_000);
  const open = (path: string) =>
    page.goto(path, { waitUntil: "domcontentloaded", timeout: 60_000 });

  await open("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Quick Generate", exact: true }),
  ).toBeVisible();

  await open("/generator");
  await expect(page.getByRole("heading", { name: /reviewable playwright draft/i })).toBeVisible();

  // The tool was renamed; the old address is kept as a permanent redirect so
  // links already sent out keep working, and this follows it on purpose.
  await open("/intelligence");
  expect(new URL(page.url()).pathname).toBe("/coverage-review");
  await expect(page.getByRole("heading", { name: /quality gap/i })).toBeVisible();

  await open("/pricing");
  await expect(page.getByRole("heading", { name: /start free/i })).toBeVisible();

  await open("/privacy");
  await expect(page.getByRole("heading", { name: "Privacy notice" })).toBeVisible();
  await expect(page.getByText(/paid checkout remains disabled/i)).toBeVisible();

  await open("/terms");
  await expect(page.getByRole("heading", { name: "Preview terms" })).toBeVisible();
  await expect(page.getByText(/No paid purchase today/i)).toBeVisible();
});

test("GitHub setup sends signed-out users through first-party sign-in", async ({
  request,
}) => {
  const response = await request.get(
    "/api/github/setup/start?orgSlug=example-workspace&projectId=47c1ee9a-0d58-4b73-8e26-99ece57b10a1",
    { maxRedirects: 0 },
  );

  expect(response.status()).toBe(307);
  expect(response.headers().location).toMatch(/^\/sign-in\?redirect_url=/);
});
