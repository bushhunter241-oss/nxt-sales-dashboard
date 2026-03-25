import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(request: Request) {
  const db = createClient(supabaseUrl, supabaseAnonKey);
  const url = new URL(request.url);
  const targetAsin = url.searchParams.get("asin") || "B0FKZX23LL";

  // 1. 対象ASINの商品情報を取得
  const { data: targetProduct } = await db
    .from("products")
    .select("id, name, asin, sku, product_group, is_parent, parent_asin")
    .eq("asin", targetAsin)
    .single();

  if (!targetProduct) {
    return NextResponse.json({ error: `ASIN ${targetAsin} not found` });
  }

  // 2. この商品の全広告データを取得（日付・キャンペーン名・source含む）
  const { data: adRecords } = await db
    .from("daily_advertising")
    .select("*")
    .eq("product_id", targetProduct.id)
    .order("date", { ascending: false });

  // 3. 月別集計
  const monthlyAgg: Record<string, { ad_spend: number; ad_sales: number; count: number; campaigns: Set<string>; sources: Set<string> }> = {};
  for (const row of adRecords || []) {
    const ym = row.date.slice(0, 7);
    if (!monthlyAgg[ym]) monthlyAgg[ym] = { ad_spend: 0, ad_sales: 0, count: 0, campaigns: new Set(), sources: new Set() };
    monthlyAgg[ym].ad_spend += row.ad_spend;
    monthlyAgg[ym].ad_sales += row.ad_sales;
    monthlyAgg[ym].count++;
    if (row.campaign_name) monthlyAgg[ym].campaigns.add(row.campaign_name);
    if (row.source) monthlyAgg[ym].sources.add(row.source);
  }
  const monthlySummary = Object.entries(monthlyAgg).map(([month, v]) => ({
    month,
    ad_spend: v.ad_spend,
    ad_sales: v.ad_sales,
    record_count: v.count,
    campaigns: [...v.campaigns],
    sources: [...v.sources],
  }));

  // 4. 同グループの兄弟商品の広告データも確認
  const { data: siblingProducts } = await db
    .from("products")
    .select("id, name, asin, sku, is_parent, parent_asin")
    .eq("product_group", targetProduct.product_group);

  const siblingAdSummary = [];
  for (const sib of siblingProducts || []) {
    const { data: sibAds } = await db
      .from("daily_advertising")
      .select("ad_spend, ad_sales, campaign_name, source, date")
      .eq("product_id", sib.id);

    const totalSpend = (sibAds || []).reduce((s, r) => s + r.ad_spend, 0);
    const totalSales = (sibAds || []).reduce((s, r) => s + r.ad_sales, 0);
    const campaigns = [...new Set((sibAds || []).map(r => r.campaign_name).filter(Boolean))];
    const sources = [...new Set((sibAds || []).map(r => r.source).filter(Boolean))];

    siblingAdSummary.push({
      name: sib.name,
      asin: sib.asin,
      is_parent: sib.is_parent,
      total_ad_spend: totalSpend,
      total_ad_sales: totalSales,
      record_count: (sibAds || []).length,
      campaigns,
      sources,
    });
  }

  // 5. CSVインポートのソース別に分類
  const bySource: Record<string, { count: number; total_spend: number }> = {};
  for (const row of adRecords || []) {
    const src = row.source || "unknown";
    if (!bySource[src]) bySource[src] = { count: 0, total_spend: 0 };
    bySource[src].count++;
    bySource[src].total_spend += row.ad_spend;
  }

  return NextResponse.json({
    target_product: targetProduct,
    ad_records_total: {
      count: (adRecords || []).length,
      total_ad_spend: (adRecords || []).reduce((s, r) => s + r.ad_spend, 0),
      total_ad_sales: (adRecords || []).reduce((s, r) => s + r.ad_sales, 0),
    },
    by_source: bySource,
    monthly_summary: monthlySummary,
    sibling_products_ad_summary: siblingAdSummary,
    raw_records: (adRecords || []).slice(0, 30),
  });
}
