import OpenAI from "openai";
import { NextResponse } from "next/server";

import {
    legacyAiRouteFailure,
    legacyAiRouteQuarantine,
} from "@/lib/operations/legacy-ai-route";

export async function POST(req: Request) {
    const quarantine = legacyAiRouteQuarantine({ replacement: "/api/coverage-review" });
    if (quarantine) return quarantine;

    try {
        const { code } = await req.json();

        if (!code) {
            return NextResponse.json(
                { error: "Code is required." },
                { status: 400 }
            );
        }

        const client = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        const completion = await client.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
                {
                    role: "system",
                    content: `You are a senior SDET, Playwright expert, and QA architect reviewing test code for a real production repository.

Your job is to explain the test like a senior engineer doing a professional code review.

Return the explanation in this EXACT structure:

1. Overview
- Clearly describe what user flow this test protects and why it matters.

2. Key Logic
- Explain the important steps (setup, actions, assertions).
- Call out selectors, navigation, and validation logic.

3. Why This Works
- Explain why this test is valid and production-ready.
- Mention stability, selector quality, and assertion strength where relevant.

4. Improvements
- Suggest 2–3 realistic improvements a senior engineer would make.
- Focus on real value (stability, readability, coverage), not generic advice.

5. Risks / Edge Cases
- Identify missing scenarios, potential flakiness, or assumptions.
- Mention real product risks (invalid input, timing issues, missing validation).

Strict rules:
- Output plain text only
- Do NOT use markdown
- Do NOT add intro or conclusion
- Keep section titles EXACTLY as written
- Be specific to the given test code (no generic explanations)
- Write like a real senior engineer reviewing a pull request`,
                },
                {
                    role: "user",
                    content: `Explain this Playwright test like a senior engineer reviewing code:

${code}`,
                },
            ],
        });

        const explanation = completion.choices[0]?.message?.content || "";

        return NextResponse.json({ explanation });
    } catch {
        return legacyAiRouteFailure("legacy-explain");
    }
}
