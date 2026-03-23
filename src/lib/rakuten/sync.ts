/**
 * 楽天 RMS API → Supabase 同期オーケストレーター
 *
 * 受注データを取得 → 日別×商品でrakuten_daily_salesに集計保存
 * 商品マスタもrakuten_productsに自動登録
 */

import { supabase } from "@/lib/supabase";
import { fetchRakutenOrders, type RakutenOrder, type OrderItem } from "./orders";
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
  parent_product_id: string | null;
  is_child_sku: boolean;
  product_name: string;
  sku: string | null;
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

    // 注文全体のクーポン割引額（ポイント利用は含めない）
    const couponTotal = order.couponAllTotalPrice || 0;

    // 注文内の全商品を一度集めて合計金額を計算（クーポン按分用）
    const allItems: OrderItem[] = [];
    let orderGoodsTotal = 0;
    for (const pkg of order.PackageModelList || []) {
      for (const item of pkg.ItemModelList || []) {
        allItems.push(item);
        const units = item.units || 1;
        orderGoodsTotal += (item.priceTaxIncl || item.price || 0) * units;
      }
    }

    for (const item of allItems) {
      const skuModel = item.SkuModelList?.[0];
      // 子商品SKUを最優先。なければ親商品IDにフォールバック
      const childSkuId = skuModel?.merchantDefinedSkuId || skuModel?.variantId;
      const parentProductId = item.manageNumber || item.itemNumber || item.itemId;
      const productId = childSkuId || parentProductId || "unknown";
      const isChildSku = !!childSkuId;

      const units = item.units || 1;
      const itemGross = (item.priceTaxIncl || item.price || 0) * units;

      // クーポン割引を商品金額の比率で按分
      const couponShare = (couponTotal > 0 && orderGoodsTotal > 0)
        ? Math.round(couponTotal * (itemGross / orderGoodsTotal))
        : 0;
      const sales = itemGross - couponShare;

      const key = `${productId}::${date}`;
      const existing = map.get(key);
      if (existing) {
        existing.orders += 1;
        existing.units_sold += units;
        existing.sales_amount += sales;
      } else {
        map.set(key, {
          product_id: productId,
          parent_product_id: isChildSku ? (parentProductId || null) : null,
          is_child_sku: isChildSku,
          product_name: item.itemName || productId,
          sku: childSkuId || null,
          date,
          orders: 1,
          units_sold: units,
          sales_amount: sales,
        });
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
    sku: string | null;
    parent_product_id: string | null;
    name: string;
    selling_price: number;
    cost_price: number;
    fee_rate: number;
  }> = [];

  for (const entry of entries) {
    // 子商品の場合はSKUで、親商品の場合はproduct_idで重複排除
    const uniqueKey = entry.is_child_sku ? (entry.sku || entry.product_id) : entry.product_id;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    // 平均単価を計算
    const avgPrice = entry.units_sold > 0
      ? Math.round(entry.sales_amount / entry.units_sold)
      : 0;

    if (entry.is_child_sku) {
      // 子商品: product_idは親商品管理番号、skuに子商品SKU
      products.push({
        product_id: entry.parent_product_id || entry.product_id,
        sku: entry.sku,
        parent_product_id: entry.parent_product_id,
        name: entry.product_name,
        selling_price: avgPrice,
        cost_price: 0,
        fee_rate: 10,  // 楽天手数料率 10%
      });
    } else {
      // 親商品
      products.push({
        product_id: entry.product_id,
        sku: null,
        parent_product_id: null,
        name: entry.product_name,
        selling_price: avgPrice,
        cost_price: 0,
        fee_rate: 10,  // 楽天手数料率 10%
      });
    }
  }

  if (products.length === 0) return 0;

  // 既存商品をチェック（product_id + sku の組み合わせで判定）
  const { data: existing } = await supabase
    .from("rakuten_products")
    .select("product_id, sku");

  const existingKeys = new Set(
    (existing || []).map(p => p.sku ? `${p.product_id}::${p.sku}` : p.product_id)
  );

  const newProducts = products.filter(p => {
    const key = p.sku ? `${p.product_id}::${p.sku}` : p.product_id;
    return !existingKeys.has(key);
  });

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
  // product_id → UUID のマッピング取得（SKUと親product_id両方で検索）
  const productIds = [...new Set(entries.map(e => e.product_id))];
  const skuIds = [...new Set(entries.filter(e => e.sku).map(e => e.sku!))];
  const parentIds = [...new Set(entries.filter(e => e.parent_product_id).map(e => e.parent_product_id!))];
  const allProductIds = [...new Set([...productIds, ...parentIds])];

  const { data: products } = await supabase
    .from("rakuten_products")
    .select("id, product_id, sku")
    .in("product_id", allProductIds);

  // SKUでのマッピング（子商品用）
  const skuMap = new Map<string, string>();
  // product_idでのマッピング（親商品用フォールバック）
  const productIdMap = new Map<string, string>();
  for (const p of products || []) {
    if (p.sku) skuMap.set(p.sku, p.id);
    if (!p.sku) productIdMap.set(p.product_id, p.id);
  }

  // エントリーのproduct_id(SKU名) → DB UUID のマッピング
  const idMap = new Map<string, string>();
  for (const entry of entries) {
    if (entry.is_child_sku && entry.sku) {
      // SKUで検索を優先
      const uuid = skuMap.get(entry.sku) || productIdMap.get(entry.parent_product_id || entry.product_id);
      if (uuid) idMap.set(entry.product_id, uuid);
    } else {
      const uuid = productIdMap.get(entry.product_id);
      if (uuid) idMap.set(entry.product_id, uuid);
    }
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
