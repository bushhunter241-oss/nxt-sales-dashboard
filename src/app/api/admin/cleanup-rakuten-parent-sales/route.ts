import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * POST /api/admin/cleanup-rakuten-parent-sales
 * 親商品に誤って紐づいた rakuten_daily_sales レコードを削除する
 *
 * Body: { dateFrom: "2025-01-01", dateTo: "2025-03-31", dryRun: true }
 */
export async function POST(request: NextRequest) {
  const db = createClient(supabaseUrl, supabaseAnonKey);

  const body = await request.json().catch(() => ({}));
  const { dateFrom, dateTo, dryRun = true } = body;

  if (!dateFrom || !dateTo) {
    return NextResponse.json(
      { error: "dateFrom と dateTo が必要です" },
      { status: 400 }
    );
  }

  try {
    // 1. 親商品（parent_product_id が NULL）の UUID リストを取得
    const { data: parentProducts, error: pErr } = await db
      .from("rakuten_products")
      .select("id, product_id, name")
      .is("parent_product_id", null);

    if (pErr) throw pErr;

    const parentIds = (parentProducts || []).map(p => p.id);
    if (parentIds.length === 0) {
      return NextResponse.json({ message: "親商品が見つかりません", deletedCount: 0 });
    }

    // 2. 子商品が存在する親商品のみ対象（子商品がある=SKU分割済み）
    const { data: childProducts } = await db
      .from("rakuten_products")
      .select("parent_product_id")
      .not("parent_product_id", "is", null);

    const parentsWithChildren = new Set(
      (childProducts || []).map(c => c.parent_product_id)
    );

    // 親商品UUIDのうち、子商品が存在するもの（＝誤って親に集約された可能性があるもの）
    const targetParentUuids = (parentProducts || [])
      .filter(p => parentsWithChildren.has(p.product_id))
      .map(p => p.id);

    if (targetParentUuids.length === 0) {
      return NextResponse.json({ message: "子商品を持つ親商品が見つかりません。クリーンアップ不要です。", deletedCount: 0 });
    }

    // 3. 対象の daily_sales レコードを検索
    const { data: targetSales, error: sErr } = await db
      .from("rakuten_daily_sales")
      .select("id, product_id, date, sales_amount, orders")
      .in("product_id", targetParentUuids)
      .gte("date", dateFrom)
      .lte("date", dateTo);

    if (sErr) throw sErr;

    const deletableCount = (targetSales || []).length;

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        deletableCount,
        targetParentProducts: (parentProducts || [])
          .filter(p => parentsWithChildren.has(p.product_id))
          .map(p => ({ product_id: p.product_id, name: p.name })),
        sampleRecords: (targetSales || []).slice(0, 10),
      });
    }

    // 4. 実際に削除
    if (deletableCount > 0) {
      const deleteIds = (targetSales || []).map(s => s.id);
      // Supabase の in() は最大1000件なので分割
      for (let i = 0; i < deleteIds.length; i += 500) {
        const batch = deleteIds.slice(i, i + 500);
        const { error: dErr } = await db
          .from("rakuten_daily_sales")
          .delete()
          .in("id", batch);
        if (dErr) throw dErr;
      }
    }

    return NextResponse.json({
      dryRun: false,
      deletedCount: deletableCount,
      message: `${deletableCount}件の親商品レコードを削除しました。楽天同期APIを再実行して子商品単位で再登録してください。`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
