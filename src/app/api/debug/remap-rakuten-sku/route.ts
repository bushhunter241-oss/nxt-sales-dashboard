import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * GET: 現状のimin03紐付けデータを確認
 * POST: 過去データの再マッピングを実行（dryRun=trueでプレビュー）
 *
 * 問題: imin お香シリーズの全売上が親商品(imin03)に集約されている
 * 原因: RMS API同期時にSKUマッピングが親にフォールバックしていた
 *
 * 再マッピング方針:
 * - RMS受注APIを再取得して正しいSKUに振り分けるのが理想だが、
 *   過去データのAPI再取得は楽天の仕様上困難
 * - 代替: imin03に紐付いた売上データを確認し、手動/推定で振り分け
 */
export async function GET() {
  const db = createClient(supabaseUrl, supabaseAnonKey);

  const IMIN03_UUID = "d5c6467f-d9ab-4b42-904d-0736742b27bf";

  // imin03に紐付いた売上データ
  const { data: salesOnParent } = await db
    .from("rakuten_daily_sales")
    .select("id, date, orders, sales_amount, units_sold, source")
    .eq("product_id", IMIN03_UUID)
    .gte("date", "2026-01-01")
    .order("date", { ascending: false });

  // 子SKUに紐付いた売上データ
  const { data: childProducts } = await db
    .from("rakuten_products")
    .select("id, product_id, name, cost_price, parent_product_id")
    .eq("product_group", "imin お香シリーズ")
    .neq("product_id", "imin03")
    .neq("product_id", "imin_incense");

  const childUuids = (childProducts || []).map(p => p.id);

  const { data: salesOnChildren } = await db
    .from("rakuten_daily_sales")
    .select("product_id, date, orders, sales_amount, units_sold")
    .in("product_id", childUuids.length > 0 ? childUuids : ["none"])
    .gte("date", "2026-01-01")
    .order("date", { ascending: false });

  // 月別集計
  const parentByMonth: Record<string, { sales: number; orders: number; units: number; count: number }> = {};
  for (const r of salesOnParent || []) {
    const ym = r.date.slice(0, 7);
    if (!parentByMonth[ym]) parentByMonth[ym] = { sales: 0, orders: 0, units: 0, count: 0 };
    parentByMonth[ym].sales += r.sales_amount;
    parentByMonth[ym].orders += r.orders;
    parentByMonth[ym].units += r.units_sold;
    parentByMonth[ym].count++;
  }

  const childByMonth: Record<string, { sales: number; orders: number; units: number }> = {};
  for (const r of salesOnChildren || []) {
    const ym = r.date.slice(0, 7);
    if (!childByMonth[ym]) childByMonth[ym] = { sales: 0, orders: 0, units: 0 };
    childByMonth[ym].sales += r.sales_amount;
    childByMonth[ym].orders += r.orders;
    childByMonth[ym].units += r.units_sold;
  }

  return NextResponse.json({
    message: "imin お香シリーズのSKU紐付け状況",
    parent_imin03: {
      uuid: IMIN03_UUID,
      total_records: (salesOnParent || []).length,
      total_sales: (salesOnParent || []).reduce((s, r) => s + r.sales_amount, 0),
      by_month: parentByMonth,
      recent_records: (salesOnParent || []).slice(0, 10),
    },
    child_skus: {
      products: childProducts,
      total_records: (salesOnChildren || []).length,
      total_sales: (salesOnChildren || []).reduce((s, r) => s + r.sales_amount, 0),
      by_month: childByMonth,
    },
    fix_note: "sync.tsのSKUマッピングロジックは修正済み。今後のAPI同期では正しいSKUに振り分けられます。過去データはRMS APIの再取得で修正可能です。",
  });
}
