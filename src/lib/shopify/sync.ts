/**
 * Shopify → Supabase 同期ロジック
 */
import { createClient } from "@supabase/supabase-js";
import { fetchOrders, type ShopifyOrder } from "./client";

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

  if (orders.length === 0) {
    return { success: true, message: `${dateFrom}〜${dateTo}: 注文なし`, ordersCount: 0, salesUpserted: 0, summaryUpserted: 0 };
  }

  const s = db();

  // SKU → products マッピング
  const { data: products } = await s.from("products").select("id, sku, asin").eq("is_archived", false);
  const skuMap = new Map<string, string>();
  for (const p of products || []) {
    if (p.sku) skuMap.set(p.sku, p.id);
  }

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
      const productId = skuMap.get(item.sku) || null;
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

  // Upsert daily summary
  let summaryUpserted = 0;
  for (const [date, agg] of Object.entries(dailySummary)) {
    const { error } = await s.from("shopify_daily_summary").upsert({
      date,
      total_orders: agg.orders,
      total_units: agg.units,
      gross_sales: Math.round(agg.gross),
      total_discounts: Math.round(agg.discounts),
      net_sales: Math.round(agg.net),
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
