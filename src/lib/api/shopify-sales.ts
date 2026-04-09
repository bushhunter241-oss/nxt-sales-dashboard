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

/** Meta広告データを日別に集計して返す（広告費・カート追加・クリック・IMP） */
export async function getMetaAdByDate(params: { startDate?: string; endDate?: string }): Promise<Record<string, { spend: number; add_to_cart: number; clicks: number; impressions: number }>> {
  let query = supabase.from("meta_ad_daily").select("date, spend, add_to_cart, clicks, impressions");
  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);
  const { data, error } = await query;
  if (error) { console.warn("getMetaAdByDate error:", error); return {}; }
  const byDate: Record<string, { spend: number; add_to_cart: number; clicks: number; impressions: number }> = {};
  for (const r of data || []) {
    if (!byDate[r.date]) byDate[r.date] = { spend: 0, add_to_cart: 0, clicks: 0, impressions: 0 };
    byDate[r.date].spend += r.spend || 0;
    byDate[r.date].add_to_cart += r.add_to_cart || 0;
    byDate[r.date].clicks += r.clicks || 0;
    byDate[r.date].impressions += r.impressions || 0;
  }
  return byDate;
}

/** Shopify売上を日別×商品で集計（原価計算用）
 *  product_idでJOINできない行はSKUで手動マッチする */
export async function getShopifyDailySalesWithCost(params: { startDate?: string; endDate?: string }) {
  let query = supabase.from("shopify_daily_sales").select("date, quantity, net_sales, sku, product_id, product:products(cost_price, commission_rate, fba_shipping_fee, sku)").order("date", { ascending: true });
  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);
  const { data, error } = await query;
  if (error) { console.warn("getShopifyDailySalesWithCost error:", error); return []; }

  // product_idがnullの行をSKUでマッチ
  const rows = data || [];
  const unmatched = rows.filter((r: any) => !r.product && r.sku);
  if (unmatched.length > 0) {
    const { data: allProducts } = await supabase.from("products").select("cost_price, commission_rate, fba_shipping_fee, sku, code").eq("is_archived", false);
    const skuMap = new Map<string, any>();
    for (const p of allProducts || []) {
      if (p.sku) skuMap.set(p.sku, p);
      if (p.code) skuMap.set(p.code, p);
    }
    for (const row of unmatched as any[]) {
      const match = skuMap.get(row.sku) || skuMap.get(row.sku + "2") || (row.sku ? skuMap.get(row.sku.replace(/\d+$/, "")) : null);
      if (match) row.product = match;
    }
  }

  return rows;
}

export async function getMetaAdDaily(params: { startDate?: string; endDate?: string }) {
  let query = supabase.from("meta_ad_daily").select("*").order("date", { ascending: false });
  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);
  const { data, error } = await query;
  if (error) { console.warn("getMetaAdDaily error:", error); return []; }
  return data || [];
}
