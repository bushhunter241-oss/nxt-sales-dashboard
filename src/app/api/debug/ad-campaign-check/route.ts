import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET() {
  const db = createClient(supabaseUrl, supabaseAnonKey);

  // 1. 浄化香キャンペーンの広告データを取得
  const { data: adData, error: adError } = await db
    .from("daily_advertising")
    .select("product_id, date, ad_spend, ad_sales, campaign_name, campaign_type")
    .ilike("campaign_name", "%浄化香%")
    .order("date", { ascending: false });

  // 2. 関連するproduct_idの商品情報を取得
  const productIds = [...new Set((adData || []).map(r => r.product_id))];
  let products: any[] = [];
  if (productIds.length > 0) {
    const { data } = await db
      .from("products")
      .select("id, name, asin, sku, product_group, is_parent, parent_asin")
      .in("id", productIds);
    products = data || [];
  }

  // 3. product_idごとに広告費を集計
  const adByProduct: Record<string, { total_ad_spend: number; total_ad_sales: number; campaigns: Set<string>; dates: string[] }> = {};
  for (const row of adData || []) {
    if (!adByProduct[row.product_id]) {
      adByProduct[row.product_id] = { total_ad_spend: 0, total_ad_sales: 0, campaigns: new Set(), dates: [] };
    }
    adByProduct[row.product_id].total_ad_spend += row.ad_spend;
    adByProduct[row.product_id].total_ad_sales += row.ad_sales;
    adByProduct[row.product_id].campaigns.add(row.campaign_name);
    adByProduct[row.product_id].dates.push(row.date);
  }

  // 4. 結果をまとめる
  const summary = productIds.map(pid => {
    const product = products.find(p => p.id === pid);
    const ad = adByProduct[pid];
    return {
      product_id: pid,
      product_name: product?.name || "不明",
      asin: product?.asin || "不明",
      sku: product?.sku || "不明",
      product_group: product?.product_group || "不明",
      is_parent: product?.is_parent || false,
      parent_asin: product?.parent_asin || null,
      total_ad_spend: ad.total_ad_spend,
      total_ad_sales: ad.total_ad_sales,
      campaigns: [...ad.campaigns],
      date_range: {
        from: ad.dates[ad.dates.length - 1],
        to: ad.dates[0],
        count: ad.dates.length,
      },
    };
  });

  // 5. お香シリーズの全商品も取得（比較用）
  const { data: allOkoProducts } = await db
    .from("products")
    .select("id, name, asin, sku, product_group, is_parent, parent_asin")
    .or("name.ilike.%浄化香%,name.ilike.%お香%,product_group.ilike.%お香%,product_group.ilike.%浄化香%");

  return NextResponse.json({
    ad_campaign_mapping: summary,
    all_oko_products: allOkoProducts,
    raw_ad_records: {
      count: (adData || []).length,
      error: adError?.message || null,
      samples: (adData || []).slice(0, 10),
    },
  });
}
