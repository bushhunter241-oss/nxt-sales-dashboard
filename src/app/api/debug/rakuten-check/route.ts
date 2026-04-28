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

  // 1. access_count > 0 のレコード（全期間）
  const { data: accessData } = await db
    .from("rakuten_daily_sales")
    .select("product_id, date, access_count, orders, sales_amount")
    .gt("access_count", 0)
    .order("date", { ascending: true })
    .limit(50);

  // 1b. 月別のアクセスデータ件数
  const { data: allAccess } = await db
    .from("rakuten_daily_sales")
    .select("date, access_count")
    .gt("access_count", 0);
  const accessByMonth: Record<string, { count: number; totalAccess: number }> = {};
  for (const r of allAccess || []) {
    const ym = r.date.slice(0, 7);
    if (!accessByMonth[ym]) accessByMonth[ym] = { count: 0, totalAccess: 0 };
    accessByMonth[ym].count++;
    accessByMonth[ym].totalAccess += r.access_count;
  }

  // 2. 広告データ
  const { data: adData } = await db
    .from("rakuten_daily_advertising")
    .select("product_id, date, ad_spend, ad_sales, campaign_name")
    .order("date", { ascending: false })
    .limit(20);

  // 3. 広告データのproduct_idとrakuten_productsのマッチング
  const adProductIds = [...new Set((adData || []).map(r => r.product_id))];
  let adProducts: any[] = [];
  if (adProductIds.length > 0) {
    const { data } = await db.from("rakuten_products").select("id, product_id, name, product_group").in("id", adProductIds);
    adProducts = data || [];
  }

  // 4. getRakutenProductSalesSummaryが使うクエリの確認
  const { data: salesWithProduct } = await db
    .from("rakuten_daily_sales")
    .select("product_id, access_count, orders, sales_amount, rakuten_product:rakuten_products(id, name, product_group)")
    .gte("date", "2026-03-01")
    .limit(10);

  return NextResponse.json({
    access_by_month: accessByMonth,
    access_records: {
      count: (accessData || []).length,
      samples: accessData?.slice(0, 20),
    },
    ad_records: {
      count: (adData || []).length,
      samples: adData,
      matched_products: adProducts,
    },
    sales_with_product: salesWithProduct,
  });
}
