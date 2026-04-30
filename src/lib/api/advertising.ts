import { supabase } from "@/lib/supabase";
import { DailyAdvertising } from "@/types/database";

export async function getDailyAdvertising(params: {
  startDate?: string;
  endDate?: string;
  productId?: string;
}) {
  // Supabaseの1000件制限に対応するためページネーション（getDailySalesと同じ方式）
  const allData: any[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from("daily_advertising")
      .select("*, product:products(*)")
      .order("date", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (params.startDate) query = query.gte("date", params.startDate);
    if (params.endDate) query = query.lte("date", params.endDate);
    if (params.productId) query = query.eq("product_id", params.productId);

    const { data, error } = await query;
    if (error) throw error;

    allData.push(...(data || []));
    hasMore = (data?.length || 0) === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  return allData.filter((r: any) => !r.product?.is_archived && !r.product?.is_parent);
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
  const allData: any[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from("daily_advertising")
      .select("date, ad_spend, product:products(is_archived, is_parent)")
      .range(offset, offset + PAGE_SIZE - 1);

    if (params.startDate) query = query.gte("date", params.startDate);
    if (params.endDate) query = query.lte("date", params.endDate);

    const { data, error } = await query;
    if (error) {
      console.warn("getDailyAdSpendByDate error:", error);
      return {};
    }

    allData.push(...(data || []));
    hasMore = (data?.length || 0) === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  const byDate: Record<string, number> = {};
  for (const row of allData) {
    const product = row.product as any;
    if (product?.is_archived || product?.is_parent) continue;
    byDate[row.date] = (byDate[row.date] || 0) + row.ad_spend;
  }
  return byDate;
}

// ── キャンペーン単位の広告費（ASIN二重計上なし） ──

/**
 * キャンペーン名 → 商品グループ のマッピング。
 * Amazon広告のキャンペーン命名規則に基づく。
 */
const CAMPAIGN_GROUP_MAP: Record<string, string> = {
  "01_feela": "feela",
  "02_imin_Moon": "imin Moonシリーズ",
  "03_imin_浄化香": "imin お香シリーズ",
  "04_mobistick": "RHINON",
  "05_imin_お得用": "imin お得用シリーズ",
  "05_iminお得用": "imin お得用シリーズ",
};

function campaignNameToGroup(campaignName: string): string {
  for (const [prefix, group] of Object.entries(CAMPAIGN_GROUP_MAP)) {
    if (campaignName.startsWith(prefix)) return group;
  }
  return "未分類";
}

/**
 * 広告費を商品グループ別に取得。
 * キャンペーン名でグループに振り分け（ASIN単位の配分ではなくキャンペーン単位）。
 * 同一キャンペーン内の複数ASINへの重複配分を防止。
 */
export async function getCampaignAdSpendByGroup(params: {
  startDate?: string;
  endDate?: string;
}): Promise<Record<string, { ad_spend: number; ad_sales: number; ad_orders: number }>> {
  let query = supabase
    .from("daily_advertising")
    .select("campaign_name, ad_spend, ad_sales, ad_orders, product:products(is_archived, is_parent)");

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) { console.warn("getCampaignAdSpendByGroup error:", error); return {}; }

  const byGroup: Record<string, { ad_spend: number; ad_sales: number; ad_orders: number }> = {};
  for (const row of data || []) {
    const product = row.product as any;
    if (product?.is_archived || product?.is_parent) continue;
    const group = row.campaign_name ? campaignNameToGroup(row.campaign_name) : "未分類";
    if (!byGroup[group]) byGroup[group] = { ad_spend: 0, ad_sales: 0, ad_orders: 0 };
    byGroup[group].ad_spend += row.ad_spend;
    byGroup[group].ad_sales += row.ad_sales;
    byGroup[group].ad_orders += row.ad_orders || 0;
  }
  return byGroup;
}

/**
 * 日別広告費合計。
 * daily_campaign_advertising はデータが不完全なため、
 * 常に daily_advertising（ASIN別）を使用する。
 */
export async function getDailyAdSpendByDateCampaignLevel(params: {
  startDate?: string;
  endDate?: string;
}): Promise<Record<string, number>> {
  return getDailyAdSpendByDate(params);
}

/**
 * 広告費合計サマリー。
 * daily_campaign_advertising はデータが不完全なため、常に daily_advertising を使用。
 */
export async function getCampaignAdSummary(params: {
  startDate?: string;
  endDate?: string;
}): Promise<{ total_ad_spend: number; total_ad_sales: number; total_ad_orders: number; total_impressions: number; total_clicks: number }> {
  return getAdSummary(params);
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
