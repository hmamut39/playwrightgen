import OpenAI from "openai";
import { NextResponse } from "next/server";
import { chromium } from "playwright-core";

import {
    legacyAiRouteFailure,
    legacyAiRouteQuarantine,
} from "@/lib/operations/legacy-ai-route";

type PageAnalysis = {
    title: string;
    url: string;
    headings: string[];
    buttons: string[];
    labels: string[];
    links: string[];
    formsCount: number;
    inputs: Array<{
        type: string;
        name: string;
        id: string;
        placeholder: string;
        ariaLabel: string;
    }>;
};

const analyzeSystemPrompt = `You are a lead software engineer and Playwright testing expert.

Your first priority is to think like a senior or lead developer writing maintainable, production-grade Playwright tests for a real codebase.
Your second priority is to think like a senior SDET who improves scenario quality, coverage, and confidence.

You will receive structured page analysis from a live page.

Your job:
- infer the most valuable user-facing scenarios
- identify the main flow first
- include validation or negative scenarios when clearly relevant
- prefer realistic, maintainable Playwright code
- prefer test.describe(...) when multiple related tests make sense
- use test.beforeEach(...) when shared setup reduces repetition
- use clear repository-style test names such as "should ..."
- output only valid Playwright TypeScript code
- do not include markdown fences
- do not include explanations
- do not include planning notes`;

function normalizeText(values: string[], limit = 12) {
    return values
        .map((value) => value.trim())
        .filter(Boolean)
        .filter((value, index, arr) => arr.indexOf(value) === index)
        .slice(0, limit);
}

async function extractPageAnalysis(url: string): Promise<PageAnalysis> {
    const browser = await chromium.connectOverCDP(
        `wss://production-sfo.browserless.io?token=${process.env.BROWSERLESS_API_KEY}`
    );

    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
    });

    const page = await context.newPage();

    try {
        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
        });

        await page.waitForTimeout(1500);

        const analysis = await page.evaluate(() => {
            const getText = (elements: Element[]) =>
                elements
                    .map((el) => (el.textContent || "").trim())
                    .filter(Boolean);

            const title = document.title || "";

            const headings = getText([
                ...document.querySelectorAll("h1, h2, h3"),
            ]);

            const buttons = [
                ...document.querySelectorAll("button, input[type='submit'], input[type='button']"),
            ]
                .map((el) => {
                    if (el instanceof HTMLInputElement) {
                        return el.value?.trim() || "";
                    }
                    return (el.textContent || "").trim();
                })
                .filter(Boolean);

            const labels = getText([...document.querySelectorAll("label")]);

            const links = getText([...document.querySelectorAll("a")]);

            const formsCount = document.querySelectorAll("form").length;

            const inputs = [...document.querySelectorAll("input, textarea, select")]
                .map((el) => {
                    const htmlEl = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
                    return {
                        type: "type" in htmlEl ? htmlEl.type || "" : el.tagName.toLowerCase(),
                        name: htmlEl.getAttribute("name") || "",
                        id: htmlEl.getAttribute("id") || "",
                        placeholder: htmlEl.getAttribute("placeholder") || "",
                        ariaLabel: htmlEl.getAttribute("aria-label") || "",
                    };
                });

            return {
                title,
                headings,
                buttons,
                labels,
                links,
                formsCount,
                inputs,
            };
        });

        return {
            title: analysis.title.trim(),
            url: page.url(),
            headings: normalizeText(analysis.headings, 12),
            buttons: normalizeText(analysis.buttons, 12),
            labels: normalizeText(analysis.labels, 12),
            links: normalizeText(analysis.links, 12),
            formsCount: analysis.formsCount,
            inputs: analysis.inputs.slice(0, 15),
        };
    } finally {
        await page.close();
        await context.close();
        await browser.close();
    }
}

function buildPageContext(analysis: PageAnalysis) {
    const inputsText =
        analysis.inputs.length > 0
            ? analysis.inputs
                .map(
                    (input) =>
                        `input: type="${input.type}", name="${input.name}", id="${input.id}", placeholder="${input.placeholder}", aria-label="${input.ariaLabel}"`
                )
                .join("\n")
            : "None";

    return `
Page URL: ${analysis.url}
Page title: ${analysis.title || "Unknown"}

Headings:
${analysis.headings.length ? analysis.headings.join("\n") : "None"}

Buttons:
${analysis.buttons.length ? analysis.buttons.join("\n") : "None"}

Labels:
${analysis.labels.length ? analysis.labels.join("\n") : "None"}

Links:
${analysis.links.length ? analysis.links.join("\n") : "None"}

Form count:
${analysis.formsCount}

Inputs:
${inputsText}
`.trim();
}

export async function POST(req: Request) {
    const quarantine = legacyAiRouteQuarantine({ replacement: "/api/quick-generate" });
    if (quarantine) return quarantine;

    try {
        const { url, styleMode } = await req.json();

        if (!url || typeof url !== "string") {
            return NextResponse.json(
                { error: "A valid URL is required." },
                { status: 400 }
            );
        }

        let normalizedUrl = url.trim();

        if (!/^https?:\/\//i.test(normalizedUrl)) {
            normalizedUrl = `https://${normalizedUrl}`;
        }

        const analysis = await extractPageAnalysis(normalizedUrl);
        const pageContext = buildPageContext(analysis);

        const client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        const completion = await client.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
                {
                    role: "system",
                    content: analyzeSystemPrompt,
                },
                {
                    role: "user",
                    content: `Generate a realistic Playwright test suite in TypeScript for this analyzed page.

Style Mode: ${styleMode || "clean"}

Requirements:
- infer the most valuable user flows from the page structure
- prioritize the primary flow first
- include validation or negative scenarios only when they are clearly meaningful
- prefer repository-style tests
- use stable selectors
- use test.describe(...) when appropriate
- use test.beforeEach(...) when shared setup is useful

Page Context:
${pageContext}`,
                },
            ],
        });

        const result = completion.choices[0]?.message?.content || "";

        return NextResponse.json({
            result,
            analysis,
            pageContext,
        });
    } catch {
        return legacyAiRouteFailure("legacy-analyze");
    }
}
