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

  // Amazon: is_parent=true の商品とその売上
  const { data: parentProducts } = await db.from("products").select("id, name, asin, is_parent, is_archived, parent_asin, product_group").or("is_parent.eq.true,parent_asin.is.null");

  const parentIds = (parentProducts || []).filter(p => p.is_parent).map(p => p.id);
  const archivedParentIds = (parentProducts || []).filter(p => p.is_archived && !p.is_parent).map(p => p.id);

  // 親ASINの売上データ（今月）
  let parentSales: any[] = [];
  if (parentIds.length > 0) {
    const { data } = await db.from("daily_sales").select("product_id, sales_amount, orders, date").in("product_id", parentIds).gte("date", "2026-03-01");
    parentSales = data || [];
  }

  const parentSalesSum = parentSales.reduce((acc: Record<string, { sales: number; orders: number; days: number }>, r) => {
    const pid = r.product_id;
    if (!acc[pid]) acc[pid] = { sales: 0, orders: 0, days: 0 };
    acc[pid].sales += r.sales_amount;
    acc[pid].orders += r.orders;
    acc[pid].days++;
    return acc;
  }, {});

  // 楽天: parent_product_id が NULLでない商品（子）と NULL（親）の売上チェック
  const { data: rktProducts } = await db.from("rakuten_products").select("id, name, product_id, sku, parent_product_id, is_archived");
  const rktParents = (rktProducts || []).filter(p => !p.parent_product_id && !p.is_archived);
  const rktChildren = (rktProducts || []).filter(p => p.parent_product_id);

  // 親と子の両方にsalesデータがあるか
  const rktParentIds = rktParents.map(p => p.id);
  let rktParentSales: any[] = [];
  if (rktParentIds.length > 0) {
    const { data } = await db.from("rakuten_daily_sales").select("product_id, sales_amount, orders").in("product_id", rktParentIds).gte("date", "2026-03-01");
    rktParentSales = data || [];
  }

  const rktParentSalesSum = rktParentSales.reduce((acc: Record<string, { sales: number; orders: number }>, r) => {
    if (!acc[r.product_id]) acc[r.product_id] = { sales: 0, orders: 0 };
    acc[r.product_id].sales += r.sales_amount;
    acc[r.product_id].orders += r.orders;
    return acc;
  }, {});

  return NextResponse.json({
    amazon: {
      parent_products: (parentProducts || []).filter(p => p.is_parent).map(p => ({
        id: p.id, name: p.name, asin: p.asin, is_archived: p.is_archived, product_group: p.product_group,
        march_sales: parentSalesSum[p.id] || { sales: 0, orders: 0, days: 0 },
      })),
      archived_with_sales: archivedParentIds.length,
    },
    rakuten: {
      parent_products_with_sales: rktParents.filter(p => rktParentSalesSum[p.id]?.sales > 0).map(p => ({
        id: p.id, name: p.name, product_id: p.product_id,
        march_sales: rktParentSalesSum[p.id],
      })),
      parents_with_children: rktParents.filter(p => rktChildren.some(c => c.parent_product_id === p.product_id)).map(p => p.product_id),
    },
  });
}
