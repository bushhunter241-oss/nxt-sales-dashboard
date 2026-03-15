import { supabase } from "@/lib/supabase";
import { RakutenDailyAdvertising } from "@/types/database";

export async function getRakutenDailyAdvertising(params: {
  startDate?: string;
  endDate?: string;
  productId?: string;
}) {
  let query = supabase
    .from("rakuten_daily_advertising")
    .select("*, rakuten_product:rakuten_products(*)")
    .order("date", { ascending: false });

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);
  if (params.productId) query = query.eq("product_id", params.productId);

  const { data, error } = await query;
  if (error) { console.warn("getRakutenDailyAdvertising error:", error); return []; }
  return data || [];
}

export async function getRakutenAdSummary(params: {
  startDate?: string;
  endDate?: string;
}) {
  let query = supabase
    .from("rakuten_daily_advertising")
    .select("ad_spend, ad_sales, impressions, clicks");

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) {
    console.warn("getRakutenAdSummary error:", error);
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

export async function upsertRakutenDailyAdvertising(ad: Omit<RakutenDailyAdvertising, "id" | "created_at">) {
  const { data, error } = await supabase
    .from("rakuten_daily_advertising")
    .insert(ad)
    .select()
    .single();
  if (error) throw error;
  return data as RakutenDailyAdvertising;
}
