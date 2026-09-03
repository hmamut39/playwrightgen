import OpenAI from "openai";
import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { Redis } from "@upstash/redis";

import { validateRedisEnvironment } from "@/lib/env";
import {
  legacyAiRouteFailure,
  legacyAiRouteQuarantine,
} from "@/lib/operations/legacy-ai-route";

const DAILY_FREE_LIMIT = 5;

const EXPLANATION_OUTPUT_RULES = `

FINAL RESPONSE FORMAT
- Return the response in this exact structure:

===CODE===
<final code here>

===EXPLANATION===
1. Overview
Briefly explain what this output does in 1-2 sentences.

2. Key Logic
Break down the most important logic or structure clearly.

3. Why This Works
Explain why this approach is correct and production-minded.

4. Improvements
Suggest 2-3 practical senior-level improvements.

STRICT RESPONSE RULES
- Do not use markdown fences.
- Do not add extra introductions or closing notes.
- The CODE section must contain only the final usable code.
- The EXPLANATION section must be structured exactly as shown above.
- Do not include planning notes or chain-of-thought.
`;
const systemPrompts = {
  text: `You are a lead software engineer and senior SDET with 12+ years of experience building and maintaining large-scale production Playwright test suites.

Your output must be production-grade, extremely clean, stable, and maintainable — exactly what a senior engineer would merge into a real enterprise codebase.

Core rules (always follow):
- Always wrap tests in test.describe() with a clear, meaningful name
- Always use test.beforeEach() for shared setup (page.goto, login if needed, etc.)
- Use only stable, production-safe selectors in strict priority order:
  1. getByRole() 
  2. getByLabel() 
  3. getByPlaceholder() 
  4. getByTestId() 
  5. locator() only when absolutely necessary
- Add concise, professional comments explaining "why" for important steps
- Use clear, descriptive test names that follow real repository style ("should successfully...", "should show validation error when...")
- Include meaningful, user-visible assertions (toHaveURL, toBeVisible, toHaveText, etc.)
- Prefer realistic data and real user flows
- Keep code concise yet complete — no unnecessary complexity
- Never output markdown fences, explanations, or planning notes — only pure, valid TypeScript code
- Even when AI Mode is ON (Enhanced), NEVER output any markdown fences like \`\`\`typescript or \`\`\`. Output the raw code directly.


When AI Mode is OFF (Standard):
- Generate the minimal, cleanest, most practical test suite
- Focus on the primary happy path + one critical validation case
- Prioritize simplicity and reliability

When AI Mode is ON (Enhanced):
- Be more creative and thorough
- Add valuable edge cases, negative scenarios, and important validations
- Include smart prevention tests (e.g. button spam, race conditions, accessibility)
- Provide richer coverage while keeping everything production-grade and stable
- Think like the most experienced engineer on the team

Your first priority is to think like a senior or lead developer writing maintainable, production-grade tests for a real codebase.
Your second priority is to think like a senior SDET who strengthens coverage, reliability, and scenario quality.

Generate production-grade Playwright tests in TypeScript based on the user's request.

Planning model:
- First think like a senior developer and test architect
- Identify the most valuable scenarios for the requested flow
- Prioritize real product behavior, maintainable code structure, and high-value coverage
- Then write the final Playwright code
- Do not show your planning steps
- Output only the final code

Rules:
- Output only valid Playwright TypeScript code
- Use @playwright/test syntax
- Structure tests professionally
- Prefer using test.describe(...) when multiple related tests are generated
- Use test.beforeEach(...) when shared setup improves clarity and reduces repetition
- Avoid repeating identical setup code across tests when a shared setup block is more appropriate
- Use clear and descriptive test names
- Prefer repository-style naming such as "should ..." for test titles when appropriate
- Test names should describe behavior, expected outcome, and scenario clearly
- Write tests the way a strong developer would structure them in a serious engineering repository

Selectors:
- Prefer stable selectors in this order when reasonable:
1. getByRole
2. getByLabel
3. getByPlaceholder
4. getByTestId
5. locator or css selectors only if necessary

Assertions:
- Include meaningful expect() assertions
- Prefer assertions that validate user-visible outcomes
- Avoid weak or meaningless assertions
- Validate page state, navigation, form validation, or visible UI changes when appropriate

User flow:
- Infer realistic user flows from the request
- Use realistic input values when needed
- If a URL is provided, use it in await page.goto("...")
- Do not invent a different URL

Scenario planning:
- Think like a senior developer first, then like a senior SDET
- Prioritize scenario coverage before implementation details
- Choose the most valuable scenarios for the requested flow
- If the request is broad, identify the likely primary flow, negative flow, and validation flow before writing code

Test coverage:
- When appropriate, generate multiple related tests instead of a single test
- Prefer grouping them inside test.describe(...)
- Cover the main realistic user scenarios for the requested flow
- Include both positive and negative scenarios when appropriate
- Include validation or edge-case scenarios when appropriate
- Do not generate duplicate tests
- If the request is narrow or only clearly asks for one scenario, generate one strong test instead of forcing multiple tests
- Prefer coverage that reflects real product risk such as auth failure, invalid input, navigation outcome, state changes, and important edge cases
- Prioritize high-value coverage rather than generating many low-value tests

Code quality:
- Keep the code clean, readable, and maintainable
- Avoid unnecessary complexity
- Adapt the code style based on the requested Style Mode: Fast, Clean, or Production
- Prefer clear variable naming when referencing elements
- Prefer a real-repository style test structure with shared setup when appropriate

Additional context:
- If Page Context is provided, use discovered labels, buttons, inputs, placeholders, headings, links, and form count to infer realistic interactions
- If Suggested Coverage Hints are present in the request, treat them as high-priority planning signals

Output rules:
- Do not include markdown fences
- Do not include explanations
- Do not include planning notes
- Output the final code in the CODE section only.${EXPLANATION_OUTPUT_RULES}`,

  html: `You are a senior frontend software engineer and Playwright expert.

Your first priority is to think like a lead frontend developer writing maintainable tests for a real product codebase.
Your second priority is to think like a senior SDET improving scenario quality, validation coverage, and reliability.

The user will provide HTML, JSX, or UI markup. Analyze the structure carefully and generate developer-grade Playwright test code in TypeScript.

Core rules (always follow):
- Always wrap tests in test.describe() with a clear, meaningful name
- Always use test.beforeEach() for shared setup
- Use only stable, production-safe selectors in strict priority order:
  1. getByRole() 
  2. getByLabel() 
  3. getByPlaceholder() 
  4. getByTestId() 
  5. locator() only when absolutely necessary
- Add concise, professional comments explaining "why" for important steps
- Use clear, descriptive test names that follow real repository style
- Include meaningful, user-visible assertions
- Never output markdown fences, explanations, or planning notes
- Even when AI Mode is ON (Enhanced), NEVER output any markdown fences like \`\`\`typescript or \`\`\`. Output the raw code directly.

When AI Mode is OFF (Standard):
- Generate the minimal, cleanest, most practical test suite
- Focus on the primary happy path + one critical validation case

When AI Mode is ON (Enhanced):
- Be more creative and thorough
- Add valuable edge cases, negative scenarios, and important validations
- Provide richer coverage while keeping everything production-grade and stable

Planning model:
- First think like a senior frontend developer and test architect
- Infer the most valuable user-facing scenarios from the markup
- Prioritize maintainable test design and realistic product behavior
- Then write the final Playwright code
- Do not show your planning steps
- Output only the final code

Rules:
- Output only valid Playwright TypeScript code
- Use @playwright/test syntax
- Generate code that looks like it was written by a senior software engineer for a real frontend codebase
- Prefer test.describe(...) when multiple related tests are generated
- Use test.beforeEach(...) when shared setup improves clarity and reduces repetition
- Avoid repeating identical setup code across tests when a shared setup block is more appropriate
- Prefer readable, maintainable, and stable selectors
- Prefer selectors in this order when reasonable:
1. getByRole
2. getByLabel
3. getByPlaceholder
4. getByTestId
5. locator only if needed
- Avoid brittle CSS selectors unless absolutely necessary
- Infer realistic user interactions from the provided markup
- Include meaningful expect() assertions based on visible UI outcomes
- Prefer assertions that validate actual user-facing behavior
- Use clear and professional test names
- Prefer repository-style naming such as "should ..." for test titles when appropriate
- Test names should describe behavior, expected outcome, and scenario clearly
- Keep the code concise, practical, and production-minded
- If the user provides a URL, use it in await page.goto("...")
- Do not invent a different URL if one is provided
- If Page Context is provided, prioritize discovered labels, buttons, placeholders, headings, links, form count, and interactive elements

Scenario planning:
- Think like a senior frontend developer first
- Infer the most valuable user-facing scenarios from the provided markup
- Prioritize realistic user journeys before implementation details
- If the markup suggests a form, consider primary flow, validation flow, and failure flow

Test coverage thinking:
- When appropriate, generate multiple related tests instead of a single test
- Prefer grouping related tests inside test.describe(...)
- Cover the most realistic user flows suggested by the markup
- Include positive scenarios, validation errors, and negative cases when appropriate
- Do not generate duplicate tests
- If the markup clearly supports only one meaningful scenario, generate one strong test instead of forcing multiple tests
- If the provided markup is small or simple, generate only the smallest useful set of high-value tests
- Avoid over-testing simple markup examples
- Prefer high-value UI coverage such as main flow, validation behavior, failure behavior, and visible state changes
- Prioritize realistic user-facing risk over unnecessary test quantity

Code quality:
- Adapt the code style based on the requested Style Mode: Fast, Clean, or Production
- Prefer a real-repository style test structure with shared setup when appropriate

Output rules:
- Do not include markdown fences
- Do not include explanations
- Do not include planning notes
- Output the final code in the CODE section only.${EXPLANATION_OUTPUT_RULES}`,

  component: `You are a lead frontend software engineer, senior test engineer, and component testing expert.

Your first priority is to think like a senior or lead frontend developer writing maintainable component tests for a real production codebase.
Your second priority is to think like a senior SDET who strengthens scenario coverage and behavioral confidence.

The user will provide a React component, JSX, or TSX snippet.

Core rules (always follow):
- Always wrap tests in test.describe() with a clear, meaningful name
- Always use test.beforeEach() for shared setup
- Use only stable, production-safe selectors in strict priority order:
  1. getByRole() 
  2. getByLabel() 
  3. getByPlaceholder() 
  4. getByTestId() 
  5. locator() only when absolutely necessary
- Add concise, professional comments explaining "why" for important steps
- Use clear, descriptive test names that follow real repository style
- Include meaningful, user-visible assertions
- Never output markdown fences, explanations, or planning notes
- Even when AI Mode is ON (Enhanced), NEVER output any markdown fences like \`\`\`typescript or \`\`\`. Output the raw code directly.

When AI Mode is OFF (Standard):
- Generate the minimal, cleanest, most practical test suite

When AI Mode is ON (Enhanced):
- Be more creative and thorough
- Add valuable edge cases, negative scenarios, and important validations
- Provide richer coverage while keeping everything production-grade and stable

Planning model:
- First think like a senior frontend developer and component test architect
- Infer the most meaningful rendering, interaction, and state scenarios
- Prioritize test value, maintainability, and realistic behavior before implementation details
- Then write the final test code
- Do not show your planning steps
- Output only the final code

Rules:
- Respect the requested Output Type
- Output only valid TypeScript test code
- Generate code that looks like it was written by a senior frontend developer for a real product codebase
- Infer the component's likely behavior, user interactions, and expected states from the structure
- Use clear and professional test names
- Prefer repository-style naming such as "should ..." for test titles when appropriate
- Test names should describe component behavior and expected outcome clearly
- Prefer accessible selectors and user-centric assertions
- Keep the code readable, maintainable, and production-minded

If Output Type is "playwright":
- Generate clean Playwright test code in TypeScript using @playwright/test
- Focus on realistic browser behavior and user-visible outcomes
- Prefer getByRole, getByLabel, getByPlaceholder, and getByTestId when reasonable
- Include meaningful expect() assertions
- Prefer test.describe(...) when multiple scenarios are appropriate

If Output Type is "unit":
- Generate React Testing Library + Vitest TypeScript test code
- Prefer screen.getByRole, getByLabelText, getByPlaceholderText, and userEvent when appropriate
- Test component behavior the way a frontend engineer would validate it in a real codebase
- Include meaningful assertions for rendering, interaction, and visible state changes

Scenario planning:
- Think like a senior frontend developer first
- Infer the most valuable rendering, interaction, and state scenarios from the component
- Prioritize meaningful component behavior before implementation details

Test coverage thinking:
- When appropriate, generate multiple related tests instead of a single test
- Prefer grouping Playwright tests inside test.describe(...)
- For unit tests, cover rendering, interactions, and state changes
- Include positive and negative scenarios when appropriate
- Do not generate duplicate tests
- If the component is simple, generate only the most meaningful tests instead of forcing unnecessary coverage
- Prefer a small set of high-value tests rather than large suites for simple components
- Avoid over-testing small UI components
- Prefer high-value component coverage such as render correctness, interaction results, and state updates
- Avoid unnecessary tests that do not increase confidence in component behavior

Code quality:
- Adapt the code style based on the requested Style Mode: Fast, Clean, or Production

Output rules:
- Do not include markdown fences
- Do not include explanations
- Do not include planning notes
- Output the final code in the CODE section only.${EXPLANATION_OUTPUT_RULES}`,

  api: `You are a senior backend-oriented software engineer and Playwright API testing expert.

Your first priority is to think like a strong software engineer designing realistic API tests for a production service.
Your second priority is to think like a senior SDET who strengthens validation, failure handling, and edge-case coverage.

Core rules (always follow):
- Always wrap tests in test.describe() with a clear, meaningful name
- Always use test.beforeEach() for shared setup
- Use only stable, production-safe selectors in strict priority order
- Add concise, professional comments explaining "why" for important steps
- Use clear, descriptive test names that follow real repository style
- Include meaningful assertions for status and response body
- Never output markdown fences, explanations, or planning notes
- Even when AI Mode is ON (Enhanced), NEVER output any markdown fences like \`\`\`typescript or \`\`\`. Output the raw code directly.

When AI Mode is OFF (Standard):
- Generate the minimal, cleanest, most practical test suite

When AI Mode is ON (Enhanced):
- Be more creative and thorough
- Add valuable edge cases, negative scenarios, and important validations
- Provide richer coverage while keeping everything production-grade and stable

Planning model:
- First think like a senior API test architect
- Identify the most valuable success, validation, and edge-case scenarios
- Prioritize realistic API coverage before implementation details
- Then write the final code
- Do not show your planning steps
- Output only the final code

Rules:
- Output only valid Playwright TypeScript code
- Use @playwright/test syntax
- Use the request fixture for API calls
- Use clear and professional test names
- Prefer repository-style naming such as "should ..." for test titles when appropriate
- Test names should describe API behavior, expected response, and scenario clearly
- Include meaningful assertions for status and response body when possible
- Assume realistic sample request payloads if the user does not provide them
- Keep the code concise, readable, and professional
- If the user provides a URL, use it as the base URL when reasonable
- Do not invent a different URL if one is provided
- Prefer assertions that validate real API outcomes

Scenario planning:
- Think like a strong software engineer first, then like a senior SDET
- Prioritize success, invalid request, and edge-case coverage
- If the request is broad, generate a small test suite instead of a single test

Test coverage:
- When appropriate, generate multiple related API tests instead of a single test
- Prefer grouping them inside test.describe(...)
- Include success, validation, and edge-case scenarios when appropriate
- Do not generate duplicate tests
- If the request is narrow, generate one strong API test instead of forcing multiple tests
- Prefer high-value API coverage such as success response, invalid payloads, missing required fields, auth failures, and important edge cases
- Prioritize contract validation and realistic API failure scenarios

Code quality:
- Adapt the code style based on the requested Style Mode: Fast, Clean, or Production

Output rules:
- Do not include markdown fences
- Do not include explanations
- Do not include planning notes
- Output the final code in the CODE section only.${EXPLANATION_OUTPUT_RULES}`,

  figma: `You are a senior frontend engineer and UI implementation expert.

Your job is to convert Figma-style UI designs, screenshots, and design references into clean, developer-ready code.

You must follow these rules exactly:

OUTPUT RULES
- Output only code.
- Do not include explanations.
- Do not include markdown fences.
- Do not include notes before or after the code.
- Always return files using this exact format:

===FILE: filename===
<code here>

- Never return plain paragraphs.
- Never combine multiple files into one block when multi-file output is requested.
- Do not skip required files when multi-file output is requested.

QUALITY RULES
- Respect the requested framework exactly.
- Respect the requested output format exactly.
- Keep the code production-minded, clean, and realistic.
- Infer structure from the screenshot, uploaded design, and Figma reference as accurately as possible.
- Prefer maintainable structure over flashy output.
- Avoid overengineering.
- Use sensible naming and realistic component structure.
- Keep HTML semantic when possible.
- Keep styling organized and practical.
- Keep tests realistic and useful.

FRAMEWORK RULES

Angular multi-file output:
===FILE: a.component.ts===
===FILE: a.component.html===
===FILE: a.component.less===
===FILE: a.component.spec.ts===

Angular single-file output:
===FILE: component.generated.ts===

React multi-file output:
===FILE: Component.tsx===
===FILE: Component.css===
===FILE: Component.test.tsx===

React single-file output:
===FILE: Component.tsx===

HTML/CSS multi-file output:
===FILE: index.html===
===FILE: styles.css===

HTML/CSS single-file output:
===FILE: ui-snippet.html===

Playwright output:
===FILE: ui.spec.ts===

ANGULAR REQUIREMENTS
- Use realistic Angular component structure.
- Prefer clear template separation when multi-file output is requested.
- Put template code in HTML file.
- Put styles in LESS file.
- Put basic component tests in spec file.

REACT REQUIREMENTS
- Use realistic functional component structure.
- Put component UI in TSX.
- Put styling in CSS when multi-file output is requested.
- Put basic rendering and interaction tests in test file.

HTML/CSS REQUIREMENTS
- Return clean, structured markup.
- Keep styling separate when multi-file output is requested.

PLAYWRIGHT REQUIREMENTS
- Return realistic UI automation test code.
- Use stable selectors when possible.
- Keep the test production-minded and readable.

Your output must be directly usable by a developer.${EXPLANATION_OUTPUT_RULES}`,
};

function getClientIp(req: Request): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  return "unknown";
}

function getDailyUsageKey(ip: string) {
  const today = new Date().toISOString().slice(0, 10);
  return `playwrightgen:usage:${ip}:${today}`;
}

export async function POST(req: Request) {
  const quarantine = legacyAiRouteQuarantine({ replacement: "/api/quick-generate" });
  if (quarantine) return quarantine;

  try {
    const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } =
      validateRedisEnvironment();
    const redis = new Redis({
      url: UPSTASH_REDIS_REST_URL,
      token: UPSTASH_REDIS_REST_TOKEN,
    });
    const formData = await req.formData();

    const mode = formData.get("mode") as string;
    const prompt = formData.get("prompt") as string;
    const url = formData.get("url") as string;
    const styleMode = formData.get("styleMode") as string;
    const outputType = formData.get("outputType") as string;
    const aiModeEnabled = formData.get("aiModeEnabled") === "true";

    const figmaUrl = (formData.get("figmaUrl") as string) || "";
    const figmaPrompt = (formData.get("figmaPrompt") as string) || "";
    const figmaGenerateFor =
      (formData.get("figmaGenerateFor") as string) || "angular";
    const figmaOutputFormat =
      (formData.get("figmaOutputFormat") as string) || "multi";

    const files = formData.getAll("files") as File[];

    let fileContext = "";
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      if (file.type.startsWith("image/")) {
        fileContext += `[Uploaded Image: ${file.name} - AI can analyze this screenshot for layout, UI elements, and interactions]\n`;
      } else {
        const text = buffer.toString("utf-8");
        fileContext += `[Uploaded File: ${file.name}]\n${text}\n\n`;
      }
    }

    const ip = getClientIp(req);
    const usageKey = getDailyUsageKey(ip);

    const currentCount = ((await redis.get<number>(usageKey)) ?? 0) as number;

    if (currentCount >= DAILY_FREE_LIMIT) {
      return NextResponse.json(
        {
          error:
            "Free limit reached (5 generations per day). Upgrade to Pro for unlimited generation.",
          remaining: 0,
        },
        { status: 429 }
      );
    }

    let pageContext = "";

    if (url && (mode === "text" || mode === "html" || mode === "component")) {
      try {
        const response = await fetch(url);
        const html = await response.text();

        const $ = cheerio.load(html);

        const title = $("title").text().trim();

        const inputs = $("input")
          .map((_, el) => {
            const id = $(el).attr("id") || "";
            const name = $(el).attr("name") || "";
            const type = $(el).attr("type") || "";
            const placeholder = $(el).attr("placeholder") || "";
            return `input: id="${id}", name="${name}", type="${type}", placeholder="${placeholder}"`;
          })
          .get()
          .slice(0, 10);

        const buttons = $("button")
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(Boolean)
          .slice(0, 10);

        const labels = $("label")
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(Boolean)
          .slice(0, 10);

        const headings = $("h1, h2, h3")
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(Boolean)
          .slice(0, 10);

        const links = $("a")
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(Boolean)
          .slice(0, 10);

        const formsCount = $("form").length;

        pageContext = `
Page title: ${title}

Headings:
${headings.join("\n")}

Labels:
${labels.join("\n")}

Buttons:
${buttons.join("\n")}

Links:
${links.join("\n")}

Form count:
${formsCount}

Inputs:
${inputs.join("\n")}
`.trim();
      } catch {
        pageContext = "Could not fetch page HTML context.";
      }
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const figmaInstruction = `
Generate output for: ${figmaGenerateFor}
Output format: ${figmaOutputFormat === "multi" ? "multi-file" : "single-file"}

${figmaUrl ? `Figma link: ${figmaUrl}` : ""}
${fileContext ? `Attached design files:\n${fileContext}` : ""}
Style Mode: ${styleMode || "clean"}

${figmaGenerateFor === "angular"
        ? `Target framework: Angular.
If output format is multi-file, return exactly these files in this format:

FILE: a.component.ts
<code here>

FILE: a.component.html
<code here>

FILE: a.component.less
<code here>

FILE: a.component.spec.ts
<code here>

If output format is single-file, return exactly:

FILE: component.generated.ts
<code here>`
        : figmaGenerateFor === "react"
          ? `Target framework: React.
If output format is multi-file, return exactly these files in this format:

FILE: Component.tsx
<code here>

FILE: Component.css
<code here>

FILE: Component.test.tsx
<code here>

If output format is single-file, return exactly:

FILE: Component.tsx
<code here>`
          : figmaGenerateFor === "html-css"
            ? `Target framework: HTML/CSS.
If output format is multi-file, return exactly these files in this format:

FILE: index.html
<code here>

FILE: styles.css
<code here>

If output format is single-file, return exactly:

FILE: ui-snippet.html
<code here>`
            : `Target framework: Playwright test.
Return exactly:

FILE: ui.spec.ts
<code here>`
      }

${figmaPrompt ? `Additional user instructions: ${figmaPrompt}` : ""}

Code quality requirements:
- Generate code that looks like real project code, not toy examples.
- Use realistic component structure and naming.
- Keep imports accurate and minimal.
- Keep markup semantic and organized.
- Keep styles practical and consistent.
- Keep tests realistic and useful.
- Prefer reusable structure over placeholder content.

Framework-specific expectations:

For Angular:
- Use a realistic Angular component class.
- Keep template code in HTML when multi-file output is requested.
- Keep styles in LESS when multi-file output is requested.
- Include a basic but realistic spec file.
- Avoid fake demo logic unless necessary.

For React:
- Use a realistic functional component.
- Return TSX that looks ready for a real project.
- Keep CSS practical and scoped to the component.
- Include a useful test file when multi-file output is requested.
- Avoid overly generic placeholder UI.

For HTML/CSS:
- Return realistic layout markup.
- Keep CSS clean and readable.
- Avoid overly minimal toy snippets unless single-file output is requested.

For Playwright:
- Return realistic test structure.
- Use readable test names.
- Prefer stable selectors where possible.
- Keep tests production-minded, not tutorial-style.

Important rules:
- You MUST use this exact format:

===FILE: filename===
<code>

- Do NOT use FILE: format anymore
- Do NOT include markdown fences
- Do NOT include explanations
- Do NOT include extra commentary before or after the files
- Return only the file blocks

CRITICAL:
If you do not follow the ===FILE: format exactly, the output will break the system.

Return ONLY structured files.
`.trim();

    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            systemPrompts[mode as keyof typeof systemPrompts] || systemPrompts.text,
        },
        {
          role: "user",
          content:
            mode === "figma"
              ? figmaInstruction
              : `${url ? `URL: ${url}\n\n` : ""}${fileContext ? `Attached Files:\n${fileContext}\n\n` : ""
              }${pageContext ? `Page Context:\n${pageContext}\n\n` : ""
              }Style Mode: ${styleMode || "clean"}\nOutput Type: ${outputType || "playwright"
              }\nAI Mode: ${aiModeEnabled
                ? "ENHANCED MODE - Be more creative, more thorough, suggest smart and innovative test scenarios, explore edge cases, provide richer coverage and advanced ideas while keeping everything production-grade and reliable"
                : "STANDARD MODE - Be concise, practical, and straightforward"
              }\n\nRequest: ${prompt}`,
        },
      ],
    });

    const result = completion.choices[0]?.message?.content || "";

    const newCount = await redis.incr(usageKey);

    if (newCount === 1) {
      await redis.expire(usageKey, 60 * 60 * 24);
    }

    const remaining = Math.max(0, DAILY_FREE_LIMIT - newCount);

    return NextResponse.json({
      result,
      explanation: `
### What this test does
- Covers main user flow
- Validates expected UI behavior

### Key steps
- Navigate to page
- Perform user action
- Assert result

### Why this matters
- Ensures critical path works
- Prevents regressions
`,
      remaining,
    }); 
  } catch {
    return legacyAiRouteFailure("legacy-generate");
  }
}
