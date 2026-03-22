import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

const SYSTEM_PROMPT = `あなたはAmazon物販に精通したプロフェッショナルなECコンサルタントです。
日本語で回答してください。データに基づいた具体的で実行可能なアドバイスを提供します。

分析レポートを求められた場合は以下の構成で回答してください：
1. 📊 現状サマリー（数値を交えた簡潔な現状把握）
2. ⚠️ 課題・リスク（データから読み取れる問題点）
3. 💡 施策提案（目標達成に向けた具体的アクション3〜5つ）
4. 📈 優先度（最も効果が高いと考えられる施策）

チャットでの質問には、コンサルタントとして的確かつ具体的に回答してください。
数値の根拠がある場合は必ず示してください。`;

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  // Helper to return a JSON error response
  function jsonError(message: string, status: number) {
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await request.json();
    const { messages, context } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return jsonError("messages is required", 400);
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return jsonError(
        "ANTHROPIC_API_KEY が設定されていません。Vercelの環境変数に設定してください。",
        500
      );
    }

    const client = new Anthropic({ apiKey });

    let systemPrompt = SYSTEM_PROMPT;
    if (context) {
      systemPrompt += `\n\n以下は分析対象の商品グループの今月の実績データです：\n${context}`;
    }

    const apiMessages: Anthropic.MessageParam[] = messages.map((m: any) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Test the API call first before starting the stream response
    // This catches auth errors, invalid model, etc. before we commit to SSE
    let stream: ReturnType<typeof client.messages.stream>;
    try {
      stream = client.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: systemPrompt,
        messages: apiMessages,
      });
    } catch (initError) {
      const msg = initError instanceof Error ? initError.message : "Failed to initialize AI";
      return jsonError(msg, 500);
    }

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        } catch (error) {
          // Send error as SSE event so frontend can display it
          let msg = "AI応答中にエラーが発生しました";
          if (error instanceof Anthropic.AuthenticationError) {
            msg = "APIキーが無効です。Vercelの環境変数 ANTHROPIC_API_KEY を確認してください。";
          } else if (error instanceof Anthropic.RateLimitError) {
            msg = "APIレート制限に達しました。しばらく待ってから再試行してください。";
          } else if (error instanceof Anthropic.BadRequestError) {
            msg = `リクエストエラー: ${error.message}`;
          } else if (error instanceof Error) {
            msg = error.message;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return jsonError(msg, 500);
  }
}
