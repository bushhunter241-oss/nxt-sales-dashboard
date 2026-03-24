import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getInsightData } from "@/lib/ai/get-insight-data";
import { INSIGHT_SYSTEM_PROMPT } from "@/lib/ai/prompts";

export const maxDuration = 30;

export async function POST() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });
  }

  try {
    const data = await getInsightData();

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: INSIGHT_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: `以下のデータを分析してインサイトを提供してください:\n\n${JSON.stringify(data, null, 2)}` },
      ],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";

    // JSONパース試行
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return NextResponse.json(parsed);
      }
    } catch {
      // JSONパース失敗時はテキストをそのまま返却
    }

    return NextResponse.json({
      insights: [{ icon: "💡", text }],
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
