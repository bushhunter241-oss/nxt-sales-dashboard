import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getEsaAuthHeader, RMS_API_BASE } from "@/lib/rakuten/auth";

/**
 * POST /api/rakuten/test
 * 楽天API接続テスト（受注検索APIを1件だけ試行）
 */
export async function POST() {
  try {
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

    // 昨日の日付で受注検索テスト
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    const res = await fetch(`${RMS_API_BASE}/es/2.0/order/searchOrder/`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        dateType: 1,
        startDatetime: `${dateStr}T00:00:00+0900`,
        endDatetime: `${dateStr}T23:59:59+0900`,
        PaginationRequestModel: {
          requestRecordsAmount: 1,
          requestPage: 1,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json({
        success: false,
        error: `API応答エラー (${res.status}): ${body.substring(0, 200)}`,
      });
    }

    const data = await res.json();
    const total = data.PaginationResponseModel?.totalRecordsAmount || 0;

    return NextResponse.json({
      success: true,
      message: `接続成功！ 昨日の受注: ${total}件`,
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : "テスト失敗",
    });
  }
}
