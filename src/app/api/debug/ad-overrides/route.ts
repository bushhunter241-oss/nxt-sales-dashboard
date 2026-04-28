import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createClient(supabaseUrl, supabaseAnonKey);

  const { data: adOverrides } = await db
    .from("amazon_monthly_ad_overrides")
    .select("*")
    .order("year_month", { ascending: true });

  const { data: dailyAdJan } = await db
    .from("daily_advertising")
    .select("date, ad_spend, ad_sales")
    .gte("date", "2026-01-01")
    .lte("date", "2026-01-31");

  const janDailyTotal = (dailyAdJan || []).reduce((acc, r) => ({
    spend: acc.spend + r.ad_spend,
    sales: acc.sales + r.ad_sales,
    count: acc.count + 1,
  }), { spend: 0, sales: 0, count: 0 });

  return NextResponse.json({
    ad_overrides: adOverrides,
    jan_daily_advertising: {
      total_spend: janDailyTotal.spend,
      total_ad_sales: janDailyTotal.sales,
      record_count: janDailyTotal.count,
    },
  });
}
