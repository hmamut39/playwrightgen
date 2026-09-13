import ts from "typescript";

/**
 * Reads a generated Playwright test into steps that can be replayed safely.
 *
 * The obvious way to "run the draft" is to execute it, and that is exactly
 * what must not happen: the code was written by a model from untrusted input,
 * and executing it on our servers would hand that input our environment. So it
 * is never executed. It is parsed, and only a closed set of Playwright calls
 * with literal arguments -- navigate, find by role/label/text/placeholder/test
 * id, click, fill, press, check, and the common web-first assertions -- become
 * steps. Anything else is listed as "not run in the preview" and never
 * evaluated. The worst a hostile draft can do is describe steps the page does
 * not have.
 */

export type TextMatch = { kind: "string"; value: string } | { kind: "regex"; source: string; flags: string };

export type LocatorStep =
  | { by: "role"; role: string; name?: TextMatch; exact?: boolean }
  | { by: "label" | "placeholder" | "text"; text: TextMatch; exact?: boolean }
  | { by: "testId"; id: string }
  | { by: "css"; selector: string }
  | { by: "first" | "last" }
  | { by: "nth"; index: number }
  | { by: "filter"; hasText: TextMatch };

export type LocatorPlan = LocatorStep[];

export type ActionName = "click" | "dblclick" | "fill" | "press" | "check" | "uncheck" | "hover" | "clear" | "selectOption";
export type MatcherName =
  | "toBeVisible" | "toBeHidden" | "toBeEnabled" | "toBeDisabled" | "toBeChecked"
  | "toHaveText" | "toContainText" | "toHaveValue" | "toHaveCount" | "toHaveClass"
  | "toHaveURL" | "toHaveTitle";

export type Operation =
  | { op: "goto"; url: string; source: string }
  | { op: "action"; action: ActionName; locator: LocatorPlan; value?: string; source: string }
  | { op: "expect"; subject: "locator"; locator: LocatorPlan; matcher: MatcherName; negated: boolean; expected?: TextMatch | number; source: string }
  | { op: "expect"; subject: "page"; matcher: "toHaveURL" | "toHaveTitle"; negated: boolean; expected: TextMatch; source: string }
  | { op: "unsupported"; reason: string; source: string };

export type PlannedStep = { name: string; operations: Operation[] };
export type PlannedTest = { name: string; steps: PlannedStep[] };
export type RunPlan = { beforeEach: Operation[]; tests: PlannedTest[] };

const ACTIONS = new Set<ActionName>(["click", "dblclick", "fill", "press", "check", "uncheck", "hover", "clear", "selectOption"]);
const VALUE_ACTIONS = new Set<ActionName>(["fill", "press", "selectOption"]);
const LOCATOR_MATCHERS = new Set<MatcherName>([
  "toBeVisible", "toBeHidden", "toBeEnabled", "toBeDisabled", "toBeChecked",
  "toHaveText", "toContainText", "toHaveValue", "toHaveCount", "toHaveClass",
]);
const MAX_TESTS = 6;
const MAX_OPERATIONS = 80;

type Value =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "regex"; source: string; flags: string }
  | { type: "page" }
  | { type: "locator"; plan: LocatorPlan }
  | { type: "expectation"; subject: "page" | "locator"; locator?: LocatorPlan; negated: boolean }
  | { type: "unknown"; reason: string };

class Unsupported extends Error {}

function unknown(reason: string): Value {
  return { type: "unknown", reason };
}

function asTextMatch(value: Value): TextMatch | null {
  if (value.type === "string") return { kind: "string", value: value.value };
  if (value.type === "regex") return { kind: "regex", source: value.source, flags: value.flags };
  return null;
}

function snippet(node: ts.Node, source: ts.SourceFile) {
  return node.getText(source).replace(/\s+/g, " ").slice(0, 160);
}

export function planPreviewRun(code: string): RunPlan {
  const source = ts.createSourceFile("draft.spec.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const plan: RunPlan = { beforeEach: [], tests: [] };
  let operationCount = 0;

  function evaluate(node: ts.Expression, scope: Map<string, Value>): Value {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
      return evaluate(node.expression, scope);
    }
    if (ts.isAwaitExpression(node)) return evaluate(node.expression, scope);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return { type: "string", value: node.text };
    if (ts.isNumericLiteral(node)) return { type: "number", value: Number(node.text) };
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
      return { type: "number", value: -Number(node.operand.text) };
    }
    if (ts.isRegularExpressionLiteral(node)) {
      const text = node.text;
      const last = text.lastIndexOf("/");
      return { type: "regex", source: text.slice(1, last), flags: text.slice(last + 1).replace(/[^gimsuy]/g, "") };
    }
    if (ts.isTemplateExpression(node)) {
      let result = node.head.text;
      for (const span of node.templateSpans) {
        const part = evaluate(span.expression, scope);
        if (part.type !== "string" && part.type !== "number") return unknown(`template uses ${snippet(span.expression, source)}`);
        result += String(part.value) + span.literal.text;
      }
      return { type: "string", value: result };
    }
    if (ts.isIdentifier(node)) {
      if (node.text === "page") return { type: "page" };
      return scope.get(node.text) ?? unknown(`uses "${node.text}", which the preview cannot evaluate`);
    }
    if (ts.isPropertyAccessExpression(node)) {
      const text = node.getText(source);
      if (text.startsWith("process.env.")) return unknown(`needs ${text.slice("process.env.".length)} from your environment`);
      if (node.name.text === "not") {
        const target = evaluate(node.expression, scope);
        if (target.type === "expectation") return { ...target, negated: !target.negated };
      }
      return unknown(`uses ${snippet(node, source)}`);
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      // process.env.X ?? 'fallback' -- the preview uses the fallback.
      const fallback = evaluate(node.right, scope);
      if (fallback.type === "string" || fallback.type === "number") return fallback;
    }
    if (ts.isCallExpression(node)) return evaluateCall(node, scope);
    return unknown(`uses ${snippet(node, source)}`);
  }

  function objectOptions(node: ts.Expression | undefined, scope: Map<string, Value>) {
    const options: Record<string, Value> = {};
    if (!node) return options;
    if (!ts.isObjectLiteralExpression(node)) throw new Unsupported("options must be written inline");
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
        throw new Unsupported("options must be simple values");
      }
      const key = property.name.text;
      if (property.initializer.kind === ts.SyntaxKind.TrueKeyword || property.initializer.kind === ts.SyntaxKind.FalseKeyword) {
        options[key] = { type: "string", value: property.initializer.kind === ts.SyntaxKind.TrueKeyword ? "true" : "false" };
      } else {
        options[key] = evaluate(property.initializer, scope);
      }
    }
    return options;
  }

  function locatorFrom(method: string, args: readonly ts.Expression[], scope: Map<string, Value>): LocatorStep | null {
    const first = args[0] ? evaluate(args[0], scope) : null;
    // Say exactly why a value cannot be used ("needs SECRET from your
    // environment") rather than a generic "not a literal".
    if (first?.type === "unknown") throw new Unsupported(first.reason);
    switch (method) {
      case "getByRole": {
        if (!first || first.type !== "string") throw new Unsupported("getByRole needs a literal role");
        const options = objectOptions(args[1], scope);
        if (options.name?.type === "unknown") throw new Unsupported(options.name.reason);
        const name = options.name ? asTextMatch(options.name) : undefined;
        if (options.name && !name) throw new Unsupported(`the name in ${method} is not a literal`);
        return { by: "role", role: first.value, ...(name ? { name } : {}), ...(options.exact ? { exact: options.exact.type === "string" && options.exact.value === "true" } : {}) };
      }
      case "getByLabel":
      case "getByPlaceholder":
      case "getByText": {
        const text = first ? asTextMatch(first) : null;
        if (!text) throw new Unsupported(`${method} needs literal text`);
        const options = objectOptions(args[1], scope);
        const by = method === "getByLabel" ? "label" : method === "getByPlaceholder" ? "placeholder" : "text";
        return { by, text, ...(options.exact ? { exact: options.exact.type === "string" && options.exact.value === "true" } : {}) };
      }
      case "getByTestId":
        if (!first || first.type !== "string") throw new Unsupported("getByTestId needs a literal id");
        return { by: "testId", id: first.value };
      case "locator":
        if (!first || first.type !== "string") throw new Unsupported("locator needs a literal selector");
        if (/^(?:xpath=|\/\/|javascript:|js=)/i.test(first.value) || /\bevaluate\b/.test(first.value)) throw new Unsupported("only CSS selectors run in the preview");
        return { by: "css", selector: first.value };
      case "first":
      case "last":
        return { by: method };
      case "nth":
        if (!first || first.type !== "number") throw new Unsupported("nth needs a literal number");
        return { by: "nth", index: first.value };
      case "filter": {
        const options = objectOptions(args[0], scope);
        const hasText = options.hasText ? asTextMatch(options.hasText) : null;
        if (!hasText) throw new Unsupported("only filter({ hasText }) runs in the preview");
        return { by: "filter", hasText };
      }
      default:
        return null;
    }
  }

  function evaluateCall(node: ts.CallExpression, scope: Map<string, Value>): Value {
    if (ts.isIdentifier(node.expression) && node.expression.text === "expect") {
      const subject = node.arguments[0] ? evaluate(node.arguments[0], scope) : unknown("empty expect");
      if (subject.type === "page") return { type: "expectation", subject: "page", negated: false };
      if (subject.type === "locator") return { type: "expectation", subject: "locator", locator: subject.plan, negated: false };
      return unknown(subject.type === "unknown" ? subject.reason : "expect on a value the preview cannot read");
    }
    if (!ts.isPropertyAccessExpression(node.expression)) return unknown(`calls ${snippet(node.expression, source)}`);
    const method = node.expression.name.text;
    const target = evaluate(node.expression.expression, scope);
    if (target.type === "unknown") return target;
    if (target.type === "page" || target.type === "locator") {
      try {
        const step = locatorFrom(method, node.arguments, scope);
        if (step) return { type: "locator", plan: [...(target.type === "locator" ? target.plan : []), step] };
      } catch (error) {
        if (error instanceof Unsupported) return unknown(error.message);
        throw error;
      }
    }
    return unknown(`calls ${method}()`);
  }

  function operationFor(node: ts.Expression, scope: Map<string, Value>): Operation {
    const text = snippet(node, source);
    const call = ts.isAwaitExpression(node) ? node.expression : node;
    if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) {
      return { op: "unsupported", reason: "not a Playwright call the preview can run", source: text };
    }
    const method = call.expression.name.text;
    const target = evaluate(call.expression.expression, scope);
    if (target.type === "unknown") return { op: "unsupported", reason: target.reason, source: text };
    const args = call.arguments.map((argument) => evaluate(argument, scope));

    if (target.type === "page") {
      if (method === "goto" && args[0]?.type === "string") return { op: "goto", url: args[0].value, source: text };
      if (method === "waitForURL" && args[0] && asTextMatch(args[0])) {
        return { op: "expect", subject: "page", matcher: "toHaveURL", negated: false, expected: asTextMatch(args[0])!, source: text };
      }
      return { op: "unsupported", reason: `page.${method}() is not run in the preview`, source: text };
    }
    if (target.type === "locator" && ACTIONS.has(method as ActionName)) {
      const action = method as ActionName;
      if (VALUE_ACTIONS.has(action)) {
        const value = args[0];
        if (!value || (value.type !== "string" && value.type !== "number")) {
          return { op: "unsupported", reason: value?.type === "unknown" ? value.reason : `${method} needs a literal value`, source: text };
        }
        return { op: "action", action, locator: target.plan, value: String(value.value), source: text };
      }
      return { op: "action", action, locator: target.plan, source: text };
    }
    if (target.type === "expectation") {
      const expected = args[0];
      if (target.subject === "page") {
        if ((method === "toHaveURL" || method === "toHaveTitle") && expected && asTextMatch(expected)) {
          return { op: "expect", subject: "page", matcher: method, negated: target.negated, expected: asTextMatch(expected)!, source: text };
        }
        return { op: "unsupported", reason: `expect(page).${method} is not run in the preview`, source: text };
      }
      if (LOCATOR_MATCHERS.has(method as MatcherName) && target.locator) {
        const matcher = method as MatcherName;
        let expectedValue: TextMatch | number | undefined;
        if (["toHaveText", "toContainText", "toHaveValue", "toHaveClass"].includes(matcher)) {
          const match = expected ? asTextMatch(expected) : null;
          if (!match) return { op: "unsupported", reason: `${matcher} needs a literal value`, source: text };
          expectedValue = match;
        } else if (matcher === "toHaveCount") {
          if (expected?.type !== "number") return { op: "unsupported", reason: "toHaveCount needs a literal number", source: text };
          expectedValue = expected.value;
        }
        return { op: "expect", subject: "locator", locator: target.locator, matcher, negated: target.negated, ...(expectedValue !== undefined ? { expected: expectedValue } : {}), source: text };
      }
      return { op: "unsupported", reason: `${method} is not run in the preview`, source: text };
    }
    return { op: "unsupported", reason: `${method}() is not run in the preview`, source: text };
  }

  /** Statements of one test (or beforeEach) body, grouped into steps. */
  function readBody(block: ts.Block, scope: Map<string, Value>, steps: PlannedStep[], current: PlannedStep) {
    for (const statement of block.statements) {
      if (operationCount >= MAX_OPERATIONS) return;
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer) {
            scope.set(declaration.name.text, evaluate(declaration.initializer, scope));
          }
        }
        continue;
      }
      if (!ts.isExpressionStatement(statement)) {
        current.operations.push({ op: "unsupported", reason: "control flow is not run in the preview", source: snippet(statement, source) });
        operationCount += 1;
        continue;
      }
      const expression = ts.isAwaitExpression(statement.expression) ? statement.expression.expression : statement.expression;
      if (
        ts.isCallExpression(expression) &&
        ts.isPropertyAccessExpression(expression.expression) &&
        expression.expression.expression.getText(source) === "test" &&
        expression.expression.name.text === "step"
      ) {
        const name = expression.arguments[0] && (ts.isStringLiteral(expression.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(expression.arguments[0]))
          ? expression.arguments[0].text
          : `Step ${steps.length + 1}`;
        const body = expression.arguments[1];
        const step: PlannedStep = { name, operations: [] };
        steps.push(step);
        if (body && (ts.isArrowFunction(body) || ts.isFunctionExpression(body)) && ts.isBlock(body.body)) {
          readBody(body.body, new Map(scope), steps, step);
          // Variables declared inside a step are visible only there, as in JS.
        }
        continue;
      }
      if (current.operations.length === 0 && !steps.includes(current)) steps.push(current);
      current.operations.push(operationFor(statement.expression, scope));
      operationCount += 1;
    }
  }

  function readSuite(statements: ts.NodeArray<ts.Statement>, scope: Map<string, Value>) {
    for (const statement of statements) {
      if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
      const call = statement.expression;
      const callee = call.expression.getText(source);
      const body = call.arguments[call.arguments.length - 1];
      const fn = body && (ts.isArrowFunction(body) || ts.isFunctionExpression(body)) && ts.isBlock(body.body) ? body.body : null;
      if (!fn) continue;
      if (callee === "test.describe" || callee === "test.describe.serial" || callee === "test.describe.parallel") {
        readSuite(fn.statements, new Map(scope));
      } else if (callee === "test.beforeEach") {
        const steps: PlannedStep[] = [];
        const setup: PlannedStep = { name: "Setup", operations: [] };
        readBody(fn, new Map(scope), steps, setup);
        plan.beforeEach.push(...steps.flatMap((step) => step.operations));
      } else if (callee === "test" && plan.tests.length < MAX_TESTS) {
        const name = call.arguments[0] && (ts.isStringLiteral(call.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(call.arguments[0]))
          ? call.arguments[0].text
          : `Test ${plan.tests.length + 1}`;
        const steps: PlannedStep[] = [];
        readBody(fn, new Map(scope), steps, { name: "Test body", operations: [] });
        plan.tests.push({ name, steps: steps.filter((step) => step.operations.length > 0) });
      }
    }
  }

  // Top-level constants (test data) are visible to every test.
  const topScope = new Map<string, Value>();
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          topScope.set(declaration.name.text, evaluate(declaration.initializer, topScope));
        }
      }
    }
  }
  readSuite(source.statements, topScope);
  return plan;
}
