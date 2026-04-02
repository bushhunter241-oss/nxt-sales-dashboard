import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchInsights } from "@/lib/meta/client";

export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** GET: Debug - fetch raw insights and compare with DB */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") || new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const insights = await fetchInsights(date, date);
    const summary = insights.map(r => ({
      date: r.date_start,
      campaign: r.campaign_name,
      spend: r.spend,
      impressions: r.impressions,
      clicks: r.clicks,
    }));
    const totalSpend = insights.reduce((s, r) => s + parseFloat(r.spend || "0"), 0);
    return NextResponse.json({ date, count: insights.length, totalSpend: Math.round(totalSpend), records: summary });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { dateFrom, dateTo } = await request.json().catch(() => ({}));
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const from = dateFrom || yesterday;
    const to = dateTo || yesterday;

    const insights = await fetchInsights(from, to);

    if (insights.length === 0) {
      return NextResponse.json({ success: true, message: `${from}〜${to}: データなし`, count: 0 });
    }

    const db = createClient(supabaseUrl, supabaseAnonKey);

    // 既存データを日付範囲で削除してから挿入（campaign levelではNULL uniqueの問題を回避）
    const { error: deleteError } = await db
      .from("meta_ad_daily")
      .delete()
      .gte("date", from)
      .lte("date", to);

    if (deleteError) {
      console.warn("meta_ad_daily delete error:", deleteError.message);
    }

    let inserted = 0;
    const errors: string[] = [];

    for (const row of insights) {
      // actionsからpurchase数とpurchase_valueを抽出
      const purchases = parseInt(row.actions?.find(a => a.action_type === "purchase")?.value || "0") || 0;
      const addToCart = parseInt(row.actions?.find(a => a.action_type === "add_to_cart")?.value || "0") || 0;
      const purchaseValue = parseFloat(row.actions?.find(a => a.action_type === "omni_purchase")?.value || row.actions?.find(a => a.action_type === "purchase")?.value || "0") || 0;

      const spend = Math.round(parseFloat(row.spend) || 0);

      const record = {
        date: row.date_start,
        campaign_name: row.campaign_name || null,
        ad_set_name: null,
        ad_name: null,
        impressions: parseInt(row.impressions) || 0,
        clicks: parseInt(row.clicks) || 0,
        spend,
        purchases,
        add_to_cart: addToCart,
        purchase_value: Math.round(purchaseValue * (spend || 1)),
        cpm: parseFloat(row.cpm) || 0,
        cpc: parseFloat(row.cpc) || 0,
        ctr: parseFloat(row.ctr) || 0,
        roas: purchaseValue > 0 && spend > 0 ? purchaseValue : 0,
      };

      const { error } = await db.from("meta_ad_daily").insert(record);

      if (error) {
        errors.push(`${row.date_start} ${row.campaign_name}: ${error.message}`);
      } else {
        inserted++;
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      message: `Meta広告 ${insights.length}件取得 → ${inserted}件保存${errors.length > 0 ? ` (${errors.length}件エラー)` : ""}`,
      count: inserted,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Meta同期エラー" },
      { status: 500 }
    );
  }
}
