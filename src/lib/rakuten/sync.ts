/**
 * 楽天 RMS API → Supabase 同期オーケストレーター
 *
 * 受注データを取得 → 日別×商品でrakuten_daily_salesに集計保存
 * 商品マスタもrakuten_productsに自動登録
 */

import { supabase } from "@/lib/supabase";
import { fetchRakutenOrders, type RakutenOrder } from "./orders";
import type { RakutenCreds } from "./orders";

interface SyncResult {
  success: boolean;
  message: string;
  ordersCount?: number;
  productsUpserted?: number;
  salesUpserted?: number;
}

interface AggEntry {
  product_id: string;
  product_name: string;
  date: string;
  orders: number;
  units_sold: number;
  sales_amount: number;
}

/**
 * 楽天受注データを日別×商品で集計
 */
function aggregateOrders(orders: RakutenOrder[]): AggEntry[] {
  const map = new Map<string, AggEntry>();

  for (const order of orders) {
    const datetime = order.orderDatetime || "";
    const date = datetime.split("T")[0];
    if (!date) continue;

    for (const pkg of order.PackageModelList || []) {
      for (const item of pkg.ItemModelList || []) {
        const sku = item.SkuModelList?.[0];
        const productId = sku?.merchantDefinedSkuId || sku?.variantId || item.itemNumber || item.manageNumber || item.itemId || "unknown";
        const units = item.units || 1;
        const sales = (item.priceTaxIncl || item.price || 0) * units;

        const key = `${productId}::${date}`;
        const existing = map.get(key);
        if (existing) {
          existing.orders += 1;
          existing.units_sold += units;
          existing.sales_amount += sales;
        } else {
          map.set(key, {
            product_id: productId,
            product_name: item.itemName || productId,
            date,
            orders: 1,
            units_sold: units,
            sales_amount: sales,
          });
        }
      }
    }
  }

  return Array.from(map.values());
}

/**
 * 商品マスタをupsert
 */
async function upsertProducts(entries: AggEntry[]): Promise<number> {
  const seen = new Set<string>();
  const products: Array<{
    product_id: string;
    name: string;
    selling_price: number;
    cost_price: number;
    fee_rate: number;
  }> = [];

  for (const entry of entries) {
    if (seen.has(entry.product_id)) continue;
    seen.add(entry.product_id);

    // 平均単価を計算
    const avgPrice = entry.units_sold > 0
      ? Math.round(entry.sales_amount / entry.units_sold)
      : 0;

    products.push({
      product_id: entry.product_id,
      name: entry.product_name,
      selling_price: avgPrice,
      cost_price: 0,
      fee_rate: 0.1, // デフォルト10%
    });
  }

  if (products.length === 0) return 0;

  // 既存商品をチェックして新規のみ追加
  const { data: existing } = await supabase
    .from("rakuten_products")
    .select("product_id")
    .in("product_id", products.map(p => p.product_id));

  const existingIds = new Set((existing || []).map(p => p.product_id));
  const newProducts = products.filter(p => !existingIds.has(p.product_id));

  if (newProducts.length > 0) {
    const { error } = await supabase
      .from("rakuten_products")
      .insert(newProducts);
    if (error) {
      console.error("楽天商品マスタ登録エラー:", error);
    }
  }

  return newProducts.length;
}

/**
 * 日別売上データをupsert
 */
async function upsertDailySales(entries: AggEntry[]): Promise<number> {
  // product_id → UUID のマッピング取得
  const productIds = [...new Set(entries.map(e => e.product_id))];
  const { data: products } = await supabase
    .from("rakuten_products")
    .select("id, product_id")
    .in("product_id", productIds);

  const idMap = new Map<string, string>();
  for (const p of products || []) {
    idMap.set(p.product_id, p.id);
  }

  let upserted = 0;

  for (const entry of entries) {
    const dbProductId = idMap.get(entry.product_id);
    if (!dbProductId) continue;

    const cvr = entry.units_sold > 0 ? 0 : 0; // アクセス数がないのでCVRは0

    const { error } = await supabase
      .from("rakuten_daily_sales")
      .upsert({
        product_id: dbProductId,
        date: entry.date,
        access_count: 0, // 受注APIではアクセス数取得不可
        orders: entry.orders,
        sales_amount: entry.sales_amount,
        units_sold: entry.units_sold,
        cvr: cvr,
        cancellations: 0,
        source: "api" as const,
      }, {
        onConflict: "product_id,date",
      });

    if (error) {
      console.error(`売上upsertエラー (${entry.product_id} ${entry.date}):`, error);
    } else {
      upserted++;
    }
  }

  return upserted;
}

/**
 * 楽天売上データ同期メイン
 */
export async function syncRakutenSales(
  creds: RakutenCreds,
  dateFrom: string,
  dateTo: string
): Promise<SyncResult> {
  try {
    // 1. 受注データ取得
    const orders = await fetchRakutenOrders(creds, dateFrom, dateTo);

    if (orders.length === 0) {
      return {
        success: true,
        message: `${dateFrom}〜${dateTo}: 受注データなし`,
        ordersCount: 0,
        productsUpserted: 0,
        salesUpserted: 0,
      };
    }

    // 2. 日別×商品で集計
    const entries = aggregateOrders(orders);

    // 3. 商品マスタ登録
    const productsUpserted = await upsertProducts(entries);

    // 4. 日別売上データ登録
    const salesUpserted = await upsertDailySales(entries);

    return {
      success: true,
      message: `楽天受注 ${orders.length}件 → 商品${productsUpserted}件新規, 売上${salesUpserted}件登録`,
      ordersCount: orders.length,
      productsUpserted,
      salesUpserted,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      message: errMsg,
    };
  }
}
