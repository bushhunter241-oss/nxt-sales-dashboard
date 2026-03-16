import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { syncRakutenSales } from "@/lib/rakuten/sync";

export const maxDuration = 120;

/**
 * POST /api/rakuten/sync
 * 楽天売上データを同期
 * body: { dateFrom?: string, dateTo?: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { dateFrom, dateTo } = body as {
      dateFrom?: string;
      dateTo?: string;
    };

    // デフォルト: 昨日
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const defaultDate = yesterday.toISOString().split("T")[0];

    const from = dateFrom || defaultDate;
    const to = dateTo || dateFrom || defaultDate;

    // 認証情報取得
    const { data: cred, error: credError } = await supabase
      .from("rakuten_api_credentials")
      .select("*")
      .single();

    if (credError || !cred) {
      return NextResponse.json(
        { success: false, message: "楽天API認証情報が設定されていません" },
        { status: 400 }
      );
    }

    const result = await syncRakutenSales(
      {
        serviceSecret: cred.service_secret,
        licenseKey: cred.license_key,
      },
      from,
      to
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "同期に失敗しました";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
