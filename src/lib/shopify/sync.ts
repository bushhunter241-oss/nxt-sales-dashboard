/**
 * Shopify → Supabase 同期ロジック
 */
import { createClient } from "@supabase/supabase-js";
import { fetchOrders, fetchDailyAnalytics, type ShopifyOrder } from "./client";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
function db() { return createClient(supabaseUrl, supabaseAnonKey); }

interface SyncResult {
  success: boolean;
  message: string;
  ordersCount: number;
  salesUpserted: number;
  summaryUpserted: number;
}

export async function syncShopifySales(dateFrom: string, dateTo: string): Promise<SyncResult> {
  const orders = await fetchOrders(dateFrom, dateTo);
  const s = db();

  // SKU → products マッピング（完全一致 + 末尾数字揺れ対応）
  const { data: products } = await s.from("products").select("id, sku, code").eq("is_archived", false);
  const skuMap = new Map<string, string>();
  for (const p of products || []) {
    if (p.sku) skuMap.set(p.sku, p.id);
    if (p.code) skuMap.set(p.code, p.id);
  }

  // SKUマッチ関数（完全一致 → 末尾数字なし → 末尾に2を追加）
  const matchSku = (sku: string): string | null => {
    if (!sku) return null;
    if (skuMap.has(sku)) return skuMap.get(sku)!;
    // 末尾に "2" を追加して再検索（旧SKU→新SKU対応）
    if (skuMap.has(sku + "2")) return skuMap.get(sku + "2")!;
    // 末尾の数字を除去して再検索
    const stripped = sku.replace(/\d+$/, "");
    if (stripped !== sku && skuMap.has(stripped)) return skuMap.get(stripped)!;
    return null;
  };

  // 注文明細を変換
  const salesRows: any[] = [];
  const dailySummary: Record<string, { orders: number; units: number; gross: number; discounts: number; net: number }> = {};

  for (const order of orders) {
    // refunded/voided は除外
    if (order.financial_status === "refunded" || order.financial_status === "voided") continue;

    const dateStr = order.created_at.split("T")[0];
    if (!dailySummary[dateStr]) dailySummary[dateStr] = { orders: 0, units: 0, gross: 0, discounts: 0, net: 0 };
    dailySummary[dateStr].orders++;

    for (const item of order.line_items) {
      const productId = matchSku(item.sku) || null;
      const grossSales = parseFloat(item.price) * item.quantity;
      const discount = parseFloat(item.total_discount) || 0;
      const netSales = grossSales - discount;

      salesRows.push({
        date: dateStr,
        order_id: String(order.id),
        product_id: productId,
        product_title: item.title,
        variant_title: item.variant_title || null,
        sku: item.sku || null,
        quantity: item.quantity,
        gross_sales: Math.round(grossSales),
        discounts: Math.round(discount),
        net_sales: Math.round(netSales),
        shipping: 0,
        taxes: 0,
        total_sales: Math.round(netSales),
      });

      dailySummary[dateStr].units += item.quantity;
      dailySummary[dateStr].gross += grossSales;
      dailySummary[dateStr].discounts += discount;
      dailySummary[dateStr].net += netSales;
    }
  }

  // Upsert sales rows (batch)
  let salesUpserted = 0;
  for (let i = 0; i < salesRows.length; i += 100) {
    const batch = salesRows.slice(i, i + 100);
    const { error } = await s.from("shopify_daily_sales").upsert(batch, { onConflict: "date,order_id,sku" });
    if (!error) salesUpserted += batch.length;
    else console.error("Shopify sales upsert error:", error.message);
  }

  // アナリティクスデータ取得（sessions, visitors, add_to_cart）
  let analyticsMap: Record<string, { sessions: number; visitors: number; addToCart: number }> = {};
  try {
    const analytics = await fetchDailyAnalytics(dateFrom, dateTo);
    for (const a of analytics) {
      analyticsMap[a.date] = { sessions: a.sessions, visitors: a.visitors, addToCart: a.addToCart };
    }
  } catch (e) {
    console.warn("Shopify analytics fetch failed (read_analytics scope may be missing):", e instanceof Error ? e.message : e);
  }

  // Upsert daily summary（注文データ + アナリティクス）
  // アナリティクスのみの日も含める
  const allDates = new Set([...Object.keys(dailySummary), ...Object.keys(analyticsMap)]);
  let summaryUpserted = 0;
  for (const date of allDates) {
    const agg = dailySummary[date] || { orders: 0, units: 0, gross: 0, discounts: 0, net: 0 };
    const ana = analyticsMap[date] || { sessions: 0, visitors: 0, addToCart: 0 };
    const cvr = ana.sessions > 0 ? (agg.orders / ana.sessions) * 100 : 0;
    const { error } = await s.from("shopify_daily_summary").upsert({
      date,
      total_orders: agg.orders,
      total_units: agg.units,
      gross_sales: Math.round(agg.gross),
      total_discounts: Math.round(agg.discounts),
      net_sales: Math.round(agg.net),
      sessions: ana.sessions,
      visitors: ana.visitors,
      add_to_cart: ana.addToCart,
      conversion_rate: Math.round(cvr * 100) / 100,
    }, { onConflict: "date" });
    if (!error) summaryUpserted++;
  }

  return {
    success: true,
    message: `Shopify ${orders.length}件 → 売上${salesUpserted}件, サマリー${summaryUpserted}日分`,
    ordersCount: orders.length,
    salesUpserted,
    summaryUpserted,
  };
}
