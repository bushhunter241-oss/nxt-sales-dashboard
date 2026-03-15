import { supabase } from "@/lib/supabase";
import { DailyAdvertising } from "@/types/database";

export async function getDailyAdvertising(params: {
  startDate?: string;
  endDate?: string;
  productId?: string;
}) {
  let query = supabase
    .from("daily_advertising")
    .select("*, product:products(*)")
    .order("date", { ascending: false });

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);
  if (params.productId) query = query.eq("product_id", params.productId);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getAdSummary(params: {
  startDate?: string;
  endDate?: string;
}) {
  let query = supabase
    .from("daily_advertising")
    .select("ad_spend, ad_sales, impressions, clicks");

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) {
    console.warn("getAdSummary error:", error);
    return { total_ad_spend: 0, total_ad_sales: 0, total_impressions: 0, total_clicks: 0 };
  }

  return (data || []).reduce(
    (acc, row) => ({
      total_ad_spend: acc.total_ad_spend + row.ad_spend,
      total_ad_sales: acc.total_ad_sales + row.ad_sales,
      total_impressions: acc.total_impressions + row.impressions,
      total_clicks: acc.total_clicks + row.clicks,
    }),
    { total_ad_spend: 0, total_ad_sales: 0, total_impressions: 0, total_clicks: 0 }
  );
}

export async function getDailyAdSpendByDate(params: {
  startDate?: string;
  endDate?: string;
}) {
  let query = supabase
    .from("daily_advertising")
    .select("date, ad_spend");

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) {
    console.warn("getDailyAdSpendByDate error:", error);
    return {};
  }

  // Aggregate ad_spend by date
  const byDate: Record<string, number> = {};
  for (const row of data || []) {
    byDate[row.date] = (byDate[row.date] || 0) + row.ad_spend;
  }
  return byDate;
}

export async function upsertDailyAdvertising(ad: Omit<DailyAdvertising, "id" | "created_at">) {
  const { data, error } = await supabase
    .from("daily_advertising")
    .insert(ad)
    .select()
    .single();
  if (error) throw error;
  return data as DailyAdvertising;
}
