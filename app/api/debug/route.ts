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
  const quarantine = legacyAiRouteQuarantine({
    replacement: "/workspace/{organization}/projects/{project}/test-runs",
  });
  if (quarantine) return quarantine;

  try {
    const { OPENAI_API_KEY } = validateOpenAiEnvironment();
    const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN } =
      validateRedisEnvironment();
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
    const redis = new Redis({
      url: UPSTASH_REDIS_REST_URL,
      token: UPSTASH_REDIS_REST_TOKEN,
    });
    const ip = getClientIp(req);
    const usageKey = getDailyUsageKey(ip);

    const currentCount = ((await redis.get<number>(usageKey)) ?? 0) as number;

    if (currentCount >= DAILY_FREE_LIMIT) {
      return NextResponse.json(
        {
          error: `Free limit reached (${DAILY_FREE_LIMIT} generations per day). Upgrade to Pro for unlimited generation.`,
          remaining: 0,
        },
        { status: 429 }
      );
    }

    const formData = await req.formData();

    const input = (formData.get("input") as string) || "";
    const issueType = (formData.get("issueType") as string) || "Auto Detect";
    const styleMode = (formData.get("styleMode") as string) || "clean";

    const files = formData.getAll("files") as File[];
    let fileDescriptions = "";

    for (const file of files) {
      if (!file) continue;

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      if (file.type.startsWith("image/")) {
        fileDescriptions += `[Uploaded Image: ${file.name}]\n`;
      } else {
        const text = buffer.toString("utf-8");
        fileDescriptions += `[Uploaded File: ${file.name}]\n${text}\n\n`;
      }
    }

    const userMessage = `
Issue Type: ${issueType}
Style Mode: ${styleMode}

User Input:
${input || "No input provided."}

${fileDescriptions ? `Attached Files:\n${fileDescriptions}` : "No files uploaded."}
`.trim();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a senior frontend engineer and SDET with 10+ years of experience.

Your job is to debug real-world issues in Playwright tests, React components, HTML/CSS, and layout problems.

Rules:
- Always identify the most likely root cause first
- Prefer minimal, safe fixes and change as few lines as possible
- Never rewrite large parts of code unless absolutely necessary
- Always consider side effects and regression risks
- Be practical and production-minded
- Use stable selectors
- Respect the user's issue type and style mode when relevant
- Output only in the exact JSON schema provided`,
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "debug_response",
          strict: true,
          schema: {
            type: "object",
            properties: {
              rootCause: { type: "string" },
              confidence: { type: "string", enum: ["High", "Medium", "Low"] },
              issueType: { type: "string" },
              minimalFix: { type: "string" },
              updatedCode: { type: "string" },
              why: { type: "string" },
              whatToTestNext: { type: "string" },
              risks: { type: "string" },
            },
            required: [
              "rootCause",
              "confidence",
              "issueType",
              "minimalFix",
              "updatedCode",
              "why",
              "whatToTestNext",
              "risks",
            ],
            additionalProperties: false,
          },
        },
      },
      temperature: 0.3,
    });

    const result = completion.choices[0]?.message?.content || "{}";

    const newCount = await redis.incr(usageKey);

    if (newCount === 1) {
      await redis.expire(usageKey, 60 * 60 * 24);
    }

    const remaining = Math.max(0, DAILY_FREE_LIMIT - newCount);

    return NextResponse.json({ result, remaining });
  } catch {
    return legacyAiRouteFailure("legacy-debug");
  }
}
