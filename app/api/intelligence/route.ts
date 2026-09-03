import OpenAI from "openai";
import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

import {
    validateOpenAiEnvironment,
    validateRedisEnvironment,
} from "@/lib/env";
import {
    legacyAiRouteFailure,
    legacyAiRouteQuarantine,
} from "@/lib/operations/legacy-ai-route";

const DAILY_FREE_LIMIT = 5;

function getClientIp(req: Request) {
    return (
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        "anonymous"
    );
}

function getDailyUsageKey(ip: string) {
    const today = new Date().toISOString().slice(0, 10);
    return `playwrightgen:intelligence:${ip}:${today}`;
}

function cleanJson(raw: string) {
    return raw
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
}

export async function POST(req: Request) {
    const quarantine = legacyAiRouteQuarantine({ replacement: "/api/coverage-review" });
    if (quarantine) return quarantine;

    try {
        const { OPENAI_API_KEY } = validateOpenAiEnvironment();
        const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } =
            validateRedisEnvironment();
        const client = new OpenAI({ apiKey: OPENAI_API_KEY });
        const redis = new Redis({
            url: UPSTASH_REDIS_REST_URL,
            token: UPSTASH_REDIS_REST_TOKEN,
        });
        const {
            mode,
            url,
            requirement,
            existingTests,
            uploadedFileName,
            uploadedImageName,
        } = await req.json();

        if (!url && !requirement && !existingTests) {
            return NextResponse.json(
                { error: "URL, requirement, or existing test code is required." },
                { status: 400 }
            );
        }

        const ip = getClientIp(req);
        const usageKey = getDailyUsageKey(ip);

        const currentCount = ((await redis.get<number>(usageKey)) ?? 0) as number;

        if (currentCount >= DAILY_FREE_LIMIT) {
            return NextResponse.json(
                {
                    error:
                        "Free limit reached (5 intelligence analyses per day). Upgrade to Pro for unlimited analysis.",
                    remaining: 0,
                },
                { status: 429 }
            );
        }

        const completion = await client.chat.completions.create({
            model: "gpt-4o",
            temperature: 0.25,
            messages: [
                {
                    role: "system",
                    content: `You are an elite AI Engineering Intelligence system for Senior Developers, Lead Developers, Staff Engineers, Senior SDETs, QA Architects, and automation platform teams.

This is NOT a basic QA coverage tool.
This is NOT a simple Playwright test generator.
This is an engineering intelligence engine that reviews product flows, requirements, existing Playwright tests, and automation structure like a senior technical reviewer.

Your job is to deeply analyze the provided input and identify engineering risks, test intelligence gaps, framework weaknesses, and the highest-value next automation actions.

You must think across BOTH software engineering and test engineering:
Analysis mode behavior:

If mode is "coverage":
- focus on missing business-critical flows
- identify missing edge cases
- identify regression gaps
- prioritize coverage confidence

If mode is "flaky":
- focus on flaky selectors
- unstable waits
- race conditions
- brittle locator strategies
- retry risks
- async instability  

If mode is "architecture":
- focus on duplicated setup
- reusable fixtures
- maintainability
- framework scaling problems
- poor abstraction boundaries
- test organization quality

If mode is "assertions":
- focus on weak assertions
- shallow validation   
- false-positive risk
- missing verification 
- missing user-visible checks
- weak backend/frontend validation consistency

Senior Developer / Lead Developer perspective:
- product behavior risk
- architecture weakness
- maintainability problems
- duplicated logic
- fragile UI/state flows
- async and timing risks
- regression impact
- scalability concerns
- unclear ownership boundaries
- missing validation of user-visible behavior

Senior SDET / QA Architect perspective:
- missing business-critical coverage
- weak assertions
- shallow tests
- duplicated tests
- flaky patterns
- poor locator strategy
- brittle selectors
- missing negative paths
- missing edge cases
- missing accessibility-sensitive checks
- missing auth/session/role-based scenarios
- missing CI reliability considerations

If existing Playwright tests are provided, review them like a senior engineer reviewing a real production test suite:
- identify what the tests currently cover
- identify what they do NOT cover
- identify weak or meaningless assertions
- identify likely flaky selectors or timing risks
- identify duplicated setup or repeated logic
- identify missing user-visible validation
- identify missing negative and edge scenarios
- identify framework or structure problems
- recommend specific next tests or refactors

If only a requirement or user flow is provided:
- create a senior-level engineering and automation risk analysis
- prioritize business-critical coverage
- recommend next test scenarios that would provide the most confidence

If a URL is provided:
- use it only as contextual signal
- do NOT claim you inspected the live page
- infer likely workflow risks from the URL path and provided text only

Return ONLY valid JSON in this exact shape:

{
 "coverageScore": 0,
 "coverageGaps": [
 {
 "title": "...",
 "impact": "Low | Medium | High | Critical",
 "whyItMatters": "...",
 "recommendation": "..."
 }
 ],
 "missingScenarios": [
 {
 "title": "...",
 "impact": "Low | Medium | High | Critical",
 "whyItMatters": "...",
 "recommendation": "..."
 }
 ],
 "riskPriority": [
 {
 "title": "...",
 "impact": "Low | Medium | High | Critical",
 "whyItMatters": "...",
 "recommendation": "..."
 }
 ],
 "suggestedNextTests": [
 {
 "title": "...",
 "impact": "Low | Medium | High | Critical",
 "whyItMatters": "...",
 "recommendation": "..."
 }
 ]
}

Output rules:
- Return JSON only
- Do not include markdown fences
- Do not include explanations outside JSON
- Do not include comments in JSON
- Do not add extra keys
- Use practical, senior-level language
- Avoid generic advice
- Be specific to the provided requirement or test code
- Prioritize real product risk, engineering quality, maintainability, and automation reliability
- suggestedNextTests must be directly usable as input for a Playwright generator later
- coverageScore must be a realistic number from 0 to 100 based on the quality and completeness of the provided input
- Every item inside coverageGaps, missingScenarios, riskPriority, and suggestedNextTests must be an object with title, impact, whyItMatters, and recommendation`,
                },
                {
                    role: "user",
                    content: `Analysis Mode:
${mode || "coverage"}

Page URL:
${url || "Not provided"}

Requirement / User Flow:
${requirement || "Not provided"}

Existing Playwright Tests:
${existingTests || "Not provided"}

Uploaded File:
${uploadedFileName || "Not provided"}

Uploaded Screenshot / UI Image:
${uploadedImageName || "Not provided"}

Perform a senior engineering intelligence review.

Return only valid JSON with:
coverageScore,
coverageGaps,
missingScenarios,
riskPriority,
suggestedNextTests.`,
                },
            ],
        });

        const raw = completion.choices[0]?.message?.content || "{}";

        let parsed;
        try {
            parsed = JSON.parse(cleanJson(raw));
        } catch {
            return NextResponse.json(
                { error: "AI returned invalid JSON. Please try again." },
                { status: 500 }
            );
        }

        const newCount = await redis.incr(usageKey);

        if (newCount === 1) {
            await redis.expire(usageKey, 60 * 60 * 24);
        }

        const remaining = Math.max(0, DAILY_FREE_LIMIT - newCount);

        return NextResponse.json({
            result: {
                coverageScore:
                    typeof parsed.coverageScore === "number" ? parsed.coverageScore : 70,
                coverageGaps: Array.isArray(parsed.coverageGaps)
                    ? parsed.coverageGaps
                    : [],
                missingScenarios: Array.isArray(parsed.missingScenarios)
                    ? parsed.missingScenarios
                    : [],
                riskPriority: Array.isArray(parsed.riskPriority)
                    ? parsed.riskPriority
                    : [],
                suggestedNextTests: Array.isArray(parsed.suggestedNextTests)
                    ? parsed.suggestedNextTests
                    : [],
            },
            remaining,
        });
    } catch {
        return legacyAiRouteFailure("legacy-intelligence");
    }
}
