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
  return (data || []).filter((r: any) => !r.product?.is_archived && !r.product?.is_parent);
}

export async function getAdSummary(params: {
  startDate?: string;
  endDate?: string;
}) {
  let query = supabase
    .from("daily_advertising")
    .select("ad_spend, ad_sales, ad_orders, impressions, clicks, product:products(is_archived, is_parent)");

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) {
    console.warn("getAdSummary error:", error);
    return { total_ad_spend: 0, total_ad_sales: 0, total_ad_orders: 0, total_impressions: 0, total_clicks: 0 };
  }

  return (data || []).reduce(
    (acc: any, row: any) => {
      if (row.product?.is_archived || row.product?.is_parent) return acc;
      return {
        total_ad_spend: acc.total_ad_spend + row.ad_spend,
        total_ad_sales: acc.total_ad_sales + row.ad_sales,
        total_ad_orders: acc.total_ad_orders + (row.ad_orders || 0),
        total_impressions: acc.total_impressions + row.impressions,
        total_clicks: acc.total_clicks + row.clicks,
      };
    },
    { total_ad_spend: 0, total_ad_sales: 0, total_ad_orders: 0, total_impressions: 0, total_clicks: 0 }
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

// ── キャンペーン単位の広告費（ASIN二重計上なし） ──

/**
 * キャンペーン単位の広告費を商品グループ別に取得。
 * spAdvertisedProduct のASIN別合計ではなく、spCampaigns の正確な値。
 */
export async function getCampaignAdSpendByGroup(params: {
  startDate?: string;
  endDate?: string;
}): Promise<Record<string, { ad_spend: number; ad_sales: number; ad_orders: number }>> {
  let query = supabase
    .from("daily_campaign_advertising")
    .select("campaign_name, product_group, ad_spend, ad_sales, ad_orders");

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) { console.warn("getCampaignAdSpendByGroup error:", error); return {}; }

  const byGroup: Record<string, { ad_spend: number; ad_sales: number; ad_orders: number }> = {};
  for (const row of data || []) {
    const group = row.product_group || "未分類";
    if (!byGroup[group]) byGroup[group] = { ad_spend: 0, ad_sales: 0, ad_orders: 0 };
    byGroup[group].ad_spend += row.ad_spend;
    byGroup[group].ad_sales += row.ad_sales;
    byGroup[group].ad_orders += row.ad_orders || 0;
  }
  return byGroup;
}

/**
 * キャンペーン単位の日別広告費合計（ASIN二重計上なし）。
 * daily_campaign_advertising が空の場合は既存のASIN別データにフォールバック。
 */
export async function getDailyAdSpendByDateCampaignLevel(params: {
  startDate?: string;
  endDate?: string;
}): Promise<Record<string, number>> {
  let query = supabase
    .from("daily_campaign_advertising")
    .select("date, ad_spend");

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;

  // フォールバック: campaign テーブルが空ならASIN別データを使用
  if (error || !data || data.length === 0) {
    return getDailyAdSpendByDate(params);
  }

  const byDate: Record<string, number> = {};
  for (const row of data) {
    byDate[row.date] = (byDate[row.date] || 0) + row.ad_spend;
  }
  return byDate;
}

/**
 * キャンペーン単位の広告費合計サマリー（ASIN二重計上なし）。
 * daily_campaign_advertising が空の場合は既存のgetAdSummaryにフォールバック。
 */
export async function getCampaignAdSummary(params: {
  startDate?: string;
  endDate?: string;
}): Promise<{ total_ad_spend: number; total_ad_sales: number; total_ad_orders: number; total_impressions: number; total_clicks: number }> {
  let query = supabase
    .from("daily_campaign_advertising")
    .select("ad_spend, ad_sales, ad_orders, impressions, clicks");

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;

  // フォールバック
  if (error || !data || data.length === 0) {
    return getAdSummary(params);
  }

  return data.reduce(
    (acc, row) => ({
      total_ad_spend: acc.total_ad_spend + row.ad_spend,
      total_ad_sales: acc.total_ad_sales + row.ad_sales,
      total_ad_orders: acc.total_ad_orders + (row.ad_orders || 0),
      total_impressions: acc.total_impressions + row.impressions,
      total_clicks: acc.total_clicks + row.clicks,
    }),
    { total_ad_spend: 0, total_ad_sales: 0, total_ad_orders: 0, total_impressions: 0, total_clicks: 0 }
  );
}

export async function upsertDailyAdvertising(ad: Omit<DailyAdvertising, "id" | "created_at">) {
  const { data, error } = await supabase
    .from("daily_advertising")
    .upsert(ad, { onConflict: "product_id,date,campaign_type" })
    .select()
    .single();
  if (error) throw error;
  return data as DailyAdvertising;
}
