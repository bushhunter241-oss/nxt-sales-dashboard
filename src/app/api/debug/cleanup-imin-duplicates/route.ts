import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const IMIN03_UUID = "d5c6467f-d9ab-4b42-904d-0736742b27bf";

/**
 * GET: 重複レコードの確認
 * POST: 重複レコードの削除実行（?dryRun=true でプレビュー）
 */
export async function GET() {
  const db = createClient(supabaseUrl, supabaseAnonKey);

  // imin お香シリーズの子SKU UUIDを取得
  const { data: childProducts } = await db
    .from("rakuten_products")
    .select("id, product_id, name")
    .eq("product_group", "imin お香シリーズ")
    .neq("product_id", "imin03")
    .eq("is_archived", false);

  const childUuids = (childProducts || []).map(p => p.id);

  // 親レコード（imin03）を取得
  const { data: parentRecords } = await db
    .from("rakuten_daily_sales")
    .select("id, date, orders, sales_amount, units_sold, source")
    .eq("product_id", IMIN03_UUID)
    .gte("date", "2026-01-01")
    .order("date", { ascending: false });

  // 子SKUレコードを取得
  const { data: childRecords } = await db
    .from("rakuten_daily_sales")
    .select("id, product_id, date, orders, sales_amount, units_sold, source")
    .in("product_id", childUuids.length > 0 ? childUuids : ["none"])
    .gte("date", "2026-01-01")
    .order("date", { ascending: false });

  // 子SKUの日付別インデックス
  const childByDate = new Map<string, any[]>();
  for (const r of childRecords || []) {
    if (!childByDate.has(r.date)) childByDate.set(r.date, []);
    childByDate.get(r.date)!.push(r);
  }

  // 重複判定: 親レコードの日付に子SKUレコードが存在する場合
  const duplicates: any[] = [];
  const parentOnlyDates: any[] = [];

  for (const parent of parentRecords || []) {
    const childOnSameDay = childByDate.get(parent.date) || [];
    if (childOnSameDay.length > 0) {
      // 子SKUが存在する日 → 親は重複
      const childSkuNames = childOnSameDay.map(c => {
        const prod = (childProducts || []).find(p => p.id === c.product_id);
        return prod?.product_id || c.product_id;
      });
      duplicates.push({
        parent_record_id: parent.id,
        date: parent.date,
        parent_sales: parent.sales_amount,
        parent_units: parent.units_sold,
        parent_source: parent.source,
        child_skus: childSkuNames,
        child_total_sales: childOnSameDay.reduce((s: number, c: any) => s + c.sales_amount, 0),
        child_total_units: childOnSameDay.reduce((s: number, c: any) => s + c.units_sold, 0),
      });
    } else if (parent.sales_amount > 0) {
      // 子SKUがない日 → 親のみ（削除不可、SKU未特定のまま残す）
      parentOnlyDates.push({
        record_id: parent.id,
        date: parent.date,
        sales_amount: parent.sales_amount,
        units_sold: parent.units_sold,
        source: parent.source,
      });
    }
  }

  return NextResponse.json({
    summary: {
      total_parent_records: (parentRecords || []).length,
      duplicates_to_delete: duplicates.length,
      parent_only_records: parentOnlyDates.length,
      duplicate_total_sales: duplicates.reduce((s, d) => s + d.parent_sales, 0),
    },
    duplicates,
    parent_only: parentOnlyDates,
    child_products: childProducts,
  });
}

export async function POST(request: NextRequest) {
  const db = createClient(supabaseUrl, supabaseAnonKey);
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "true";

  // 子SKU UUIDを取得
  const { data: childProducts } = await db
    .from("rakuten_products")
    .select("id, product_id")
    .eq("product_group", "imin お香シリーズ")
    .neq("product_id", "imin03")
    .eq("is_archived", false);

  const childUuids = (childProducts || []).map(p => p.id);

  // 親レコード
  const { data: parentRecords } = await db
    .from("rakuten_daily_sales")
    .select("id, date, sales_amount, units_sold")
    .eq("product_id", IMIN03_UUID)
    .gte("date", "2026-01-01");

  // 子レコードの日付Set
  const { data: childRecords } = await db
    .from("rakuten_daily_sales")
    .select("date")
    .in("product_id", childUuids.length > 0 ? childUuids : ["none"])
    .gte("date", "2026-01-01");

  const childDates = new Set((childRecords || []).map(r => r.date));

  // 子SKUが存在する日の親レコードIDを収集
  const idsToDelete: string[] = [];
  for (const parent of parentRecords || []) {
    if (childDates.has(parent.date)) {
      idsToDelete.push(parent.id);
    }
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      records_to_delete: idsToDelete.length,
      message: `${idsToDelete.length}件の親重複レコードが削除対象です。?dryRun=true を外して再実行すると削除されます。`,
    });
  }

  // 実際の削除
  let deleted = 0;
  for (const id of idsToDelete) {
    const { error } = await db
      .from("rakuten_daily_sales")
      .delete()
      .eq("id", id);

    if (!error) deleted++;
  }

  return NextResponse.json({
    success: true,
    deleted,
    total_candidates: idsToDelete.length,
    message: `${deleted}件の親重複レコードを削除しました`,
  });
}
