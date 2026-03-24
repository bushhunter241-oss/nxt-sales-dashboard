import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getChatContext } from "@/lib/ai/get-chat-context";
import { CHAT_SYSTEM_PROMPT } from "@/lib/ai/prompts";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY が未設定です" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const { message, history = [] } = await request.json();
  if (!message) {
    return new Response(JSON.stringify({ error: "message is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  try {
    const context = await getChatContext(message);

    const messages: Anthropic.MessageParam[] = [
      ...history.slice(-20).map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content })),
      {
        role: "user",
        content: `【現在のデータ】\n${JSON.stringify(context, null, 2)}\n\n【質問】\n${message}`,
      },
    ];

    const client = new Anthropic({ apiKey });

    // ストリーミング
    const stream = await client.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: CHAT_SYSTEM_PROMPT,
      messages,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (err) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
