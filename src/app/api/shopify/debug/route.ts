import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchDailyAnalytics } from "@/lib/shopify/client";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  // ?analytics=1 でShopifyQLテストのみ実行
  if (url.searchParams.get("analytics") === "1") {
    const date = url.searchParams.get("date") || "2026-04-09";
    try {
      const result = await fetchDailyAnalytics(date, date);
      return NextResponse.json({ success: true, date, result });
    } catch (error) {
      return NextResponse.json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const db = createClient(supabaseUrl, supabaseAnonKey);

  // shopify_daily_sales のSKU一覧
  const { data: shopifySales } = await db
    .from("shopify_daily_sales")
    .select("sku, product_id, product_title, net_sales, quantity")
    .order("net_sales", { ascending: false })
    .limit(30);

  // products テーブルのSKU一覧（Shopify商品 = commission_rate > 0 or product_group=feela）
  const { data: products } = await db
    .from("products")
    .select("id, name, sku, code, cost_price, commission_rate, fba_shipping_fee, product_group")
    .eq("is_archived", false);

  // SKUマッチング結果
  const productSkuMap = new Map<string, any>();
  for (const p of products || []) {
    if (p.sku) productSkuMap.set(p.sku, p);
    if (p.code) productSkuMap.set(p.code, p);
  }

  const matchResults = (shopifySales || []).map((s: any) => {
    const matchBySku = s.sku ? productSkuMap.get(s.sku) : null;
    const matchByProductId = s.product_id; // すでにUUIDで紐付いている場合
    return {
      shopify_sku: s.sku,
      shopify_product_id: s.product_id,
      product_title: s.product_title,
      net_sales: s.net_sales,
      quantity: s.quantity,
      matched_product: matchBySku ? { id: matchBySku.id, name: matchBySku.name, sku: matchBySku.sku, cost_price: matchBySku.cost_price } : null,
      has_product_id_link: !!s.product_id,
    };
  });

  // マッチしないSKU
  const unmatchedSkus = matchResults.filter((r: any) => !r.matched_product && !r.has_product_id_link);

  return NextResponse.json({
    shopify_sales_skus: [...new Set((shopifySales || []).map((s: any) => s.sku))],
    products_skus: (products || []).filter(p => p.sku).map((p: any) => ({ sku: p.sku, code: p.code, name: p.name, cost_price: p.cost_price, commission_rate: p.commission_rate })),
    match_results: matchResults,
    unmatched_skus: unmatchedSkus,
    summary: {
      total_shopify_rows: (shopifySales || []).length,
      matched: matchResults.filter((r: any) => r.matched_product || r.has_product_id_link).length,
      unmatched: unmatchedSkus.length,
    },
  });
}
