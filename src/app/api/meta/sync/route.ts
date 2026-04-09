import { NextRequest, NextResponse } from "next/server";
import { fetchInsights } from "@/lib/meta/client";
import { syncMetaAds } from "@/lib/meta/sync";

export const maxDuration = 60;

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

    const result = await syncMetaAds(from, to);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Meta同期エラー" },
      { status: 500 }
    );
  }
}
