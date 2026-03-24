import { supabase } from "@/lib/supabase";

export async function getShopifyDailySummary(params: { startDate?: string; endDate?: string }) {
  let query = supabase.from("shopify_daily_summary").select("*").order("date", { ascending: true });
  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);
  const { data, error } = await query;
  if (error) { console.warn("getShopifyDailySummary error:", error); return []; }
  return data || [];
}

export async function getShopifyProductSales(params: { startDate?: string; endDate?: string }) {
  let query = supabase.from("shopify_daily_sales").select("*, product:products(*)").order("date", { ascending: false });
  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);
  const { data, error } = await query;
  if (error) { console.warn("getShopifyProductSales error:", error); return []; }
  return (data || []).filter((r: any) => !r.product?.is_archived);
}

export async function getMetaAdSummary(params: { startDate?: string; endDate?: string }) {
  let query = supabase.from("meta_ad_daily").select("spend, purchases, purchase_value, impressions, clicks");
  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);
  const { data, error } = await query;
  if (error) { console.warn("getMetaAdSummary error:", error); return { total_spend: 0, total_purchases: 0, total_purchase_value: 0, total_impressions: 0, total_clicks: 0 }; }
  return (data || []).reduce((acc, r) => ({
    total_spend: acc.total_spend + (r.spend || 0),
    total_purchases: acc.total_purchases + (r.purchases || 0),
    total_purchase_value: acc.total_purchase_value + (r.purchase_value || 0),
    total_impressions: acc.total_impressions + (r.impressions || 0),
    total_clicks: acc.total_clicks + (r.clicks || 0),
  }), { total_spend: 0, total_purchases: 0, total_purchase_value: 0, total_impressions: 0, total_clicks: 0 });
}

export async function getMetaAdDaily(params: { startDate?: string; endDate?: string }) {
  let query = supabase.from("meta_ad_daily").select("*").order("date", { ascending: false });
  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);
  const { data, error } = await query;
  if (error) { console.warn("getMetaAdDaily error:", error); return []; }
  return data || [];
}
