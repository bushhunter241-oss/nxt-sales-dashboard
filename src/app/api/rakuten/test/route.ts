import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getEsaAuthHeader, RMS_API_BASE } from "@/lib/rakuten/auth";

/**
 * POST /api/rakuten/test
 * 楽天API接続テスト（受注検索APIを試行）
 * body: { diagnose?: boolean } — diagnose=true で複数期間・dateTypeで診断
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { diagnose } = body as { diagnose?: boolean };

    const { data: cred, error } = await supabase
      .from("rakuten_api_credentials")
      .select("*")
      .single();

    if (error || !cred) {
      return NextResponse.json(
        { success: false, error: "楽天API認証情報が設定されていません" },
        { status: 400 }
      );
    }

    const auth = getEsaAuthHeader({
      serviceSecret: cred.service_secret,
      licenseKey: cred.license_key,
    });

    // 単発テスト用ヘルパー
    async function searchCount(
      startDate: string,
      endDate: string,
      dateType: number
    ): Promise<{ total: number; error?: string; rawMessage?: string }> {
      const res = await fetch(`${RMS_API_BASE}/es/2.0/order/searchOrder/`, {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({
          dateType,
          startDatetime: `${startDate}T00:00:00+0900`,
          endDatetime: `${endDate}T23:59:59+0900`,
          PaginationRequestModel: {
            requestRecordsAmount: 1,
            requestPage: 1,
          },
        }),
      });

      const bodyText = await res.text();

      if (!res.ok) {
        return { total: 0, error: `HTTP ${res.status}: ${bodyText.substring(0, 200)}` };
      }

      if (bodyText.trimStart().startsWith("<")) {
        return { total: 0, error: `HTMLレスポンス: ${bodyText.substring(0, 100)}` };
      }

      let data;
      try {
        data = JSON.parse(bodyText);
      } catch {
        return { total: 0, error: `JSONパース失敗: ${bodyText.substring(0, 200)}` };
      }

      const msgList = data.MessageModelList || [];
      const rawMessage = msgList.length > 0
        ? msgList.map((m: { messageCode: string; message: string }) => `${m.messageCode}: ${m.message}`).join("; ")
        : undefined;

      return {
        total: data.PaginationResponseModel?.totalRecordsAmount || 0,
        rawMessage,
      };
    }

    // --- 診断モード ---
    if (diagnose) {
      const now = new Date();
      const fmt = (d: Date) => d.toISOString().split("T")[0];

      // 複数の期間を試す
      const periods = [
        { label: "昨日", start: fmt(new Date(now.getTime() - 86400000)), end: fmt(new Date(now.getTime() - 86400000)) },
        { label: "過去7日", start: fmt(new Date(now.getTime() - 7 * 86400000)), end: fmt(now) },
        { label: "過去30日", start: fmt(new Date(now.getTime() - 30 * 86400000)), end: fmt(now) },
        { label: "過去90日", start: fmt(new Date(now.getTime() - 90 * 86400000)), end: fmt(now) },
      ];

      // dateType: 1=注文日, 2=注文確認日, 3=注文確定日, 4=発送日, 6=決済日
      const dateTypes = [
        { type: 1, label: "注文日" },
        { type: 2, label: "注文確認日" },
        { type: 3, label: "注文確定日" },
      ];

      const results: Array<{
        period: string;
        dateType: string;
        total: number;
        error?: string;
        rawMessage?: string;
      }> = [];

      for (const period of periods) {
        for (const dt of dateTypes) {
          const r = await searchCount(period.start, period.end, dt.type);
          results.push({
            period: `${period.label} (${period.start}〜${period.end})`,
            dateType: `${dt.type}: ${dt.label}`,
            total: r.total,
            error: r.error,
            rawMessage: r.rawMessage,
          });

          // API負荷軽減
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      return NextResponse.json({
        success: true,
        message: "診断完了",
        diagnoseResults: results,
      });
    }

    // --- 通常テスト ---
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    const result = await searchCount(dateStr, dateStr, 1);

    if (result.error) {
      return NextResponse.json({
        success: false,
        error: result.error,
      });
    }

    return NextResponse.json({
      success: true,
      message: `接続成功！ 昨日の受注: ${result.total}件`,
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : "テスト失敗",
    });
  }
}
