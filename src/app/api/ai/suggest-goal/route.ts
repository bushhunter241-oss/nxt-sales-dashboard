import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 30;

const SYSTEM_PROMPT = `
あなたはEC事業の売上目標設定アシスタントです。
先月の実績を踏まえて今月（対象月）の目標を「保守 / 標準 / 積極」の3案で提示します。

各案の意図:
- 保守: ほぼ確実に達成できる水準（先月実績 × 0.95〜1.02）
- 標準: 実績ベースに自然な成長を上乗せ（×1.05〜1.15）。季節性・トレンドも加味
- 積極: ストレッチ目標。広告強化や新施策込み（×1.20〜1.40）

計算ルール:
- target_profit は target_sales × 先月の利益率 で算出（整数）
- target_orders は target_sales ÷ 先月平均単価 で算出（整数、四捨五入）
- target_ad_budget は先月広告費を基準に、積極案は強化（×1.2〜1.5）、保守案は据え置き
- 金額は整数（円）

ブランド情報:
- feela: 主力。座クッション。粗利44.6%。目標ACOS 25-30%
- imin お香シリーズ: 粗利55%
- imin Moonシリーズ: 粗利40%
- imin お得用シリーズ: ローンチ攻め期間（ACOS 50-60%許容）
- RHINON: ワークスペースグッズ

必ず以下のJSONのみを返してください（前後の説明文なし、コードブロックなし）:
{
  "proposals": [
    { "label": "保守", "target_sales": 0, "target_orders": 0, "target_profit": 0, "target_ad_budget": 0, "rationale": "80文字以内の根拠" },
    { "label": "標準", "target_sales": 0, "target_orders": 0, "target_profit": 0, "target_ad_budget": 0, "rationale": "80文字以内の根拠" },
    { "label": "積極", "target_sales": 0, "target_orders": 0, "target_profit": 0, "target_ad_budget": 0, "rationale": "80文字以内の根拠" }
  ],
  "insight": "先月データからの気づき・注意点（120文字以内）"
}
`.trim();

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { groupName, channel, targetMonth, lastMonth, twoMonthsAgo } = body;

    if (!groupName || !targetMonth || !lastMonth) {
      return Response.json({ error: "必須パラメータが不足しています" }, { status: 400 });
    }

    const userMessage = `
【商品グループ】${groupName}
【チャネル】${channel || "total"}
【対象月（目標を立てる月）】${targetMonth}

【先月（${lastMonth.yearMonth}）実績】
- 売上: ${lastMonth.sales.toLocaleString()}円
- 注文数: ${lastMonth.orders}件
- 純利益: ${lastMonth.profit.toLocaleString()}円
- 広告費: ${lastMonth.adSpend.toLocaleString()}円
- 利益率: ${(lastMonth.profitRate * 100).toFixed(1)}%
- 平均単価: ${lastMonth.avgPrice.toLocaleString()}円
${twoMonthsAgo ? `
【先々月（${twoMonthsAgo.yearMonth}）実績（トレンド参考）】
- 売上: ${twoMonthsAgo.sales.toLocaleString()}円
- 注文数: ${twoMonthsAgo.orders}件
- 前月比: ${twoMonthsAgo.sales > 0 ? (((lastMonth.sales - twoMonthsAgo.sales) / twoMonthsAgo.sales) * 100).toFixed(1) : "-"}%
` : ""}

上記を踏まえて3案の目標を提示してください。JSONのみ返却。
`.trim();

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return Response.json({ error: "AI応答の解析に失敗しました", raw: text }, { status: 500 });
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return Response.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: msg }, { status: 500 });
  }
}
