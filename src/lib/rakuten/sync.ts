/**
 * 楽天 RMS API → Supabase 同期オーケストレーター（v2: manageNumberベース）
 *
 * 商品管理番号(manageNumber)をキーに日別売上を集約。
 * 子SKU/親商品の複雑なマッピングを廃止し、Excelと同じ粒度で管理。
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

/** manageNumber × date の集約エントリ */
interface AggEntry {
  manage_number: string;
  product_name: string;
  date: string;
  orders: number;
  units_sold: number;
  sales_amount: number;
}

/** SKU × date の詳細エントリ（原価計算用） */
interface SkuEntry {
  manage_number: string;
  sku_id: string | null;
  date: string;
  orders: number;
  units_sold: number;
  sales_amount: number;
}

/**
 * 楽天受注データを日別×商品管理番号で集約
 */
function aggregateOrders(orders: RakutenOrder[]): {
  byManageNumber: AggEntry[];
  bySku: SkuEntry[];
} {
  const mnMap = new Map<string, AggEntry>();
  const skuMap = new Map<string, SkuEntry>();

  for (const order of orders) {
    const datetime = order.orderDatetime || "";
    const date = datetime.split("T")[0];
    if (!date) continue;

    // クーポン割引額（ポイント利用は含めない）
    const couponTotal = order.couponAllTotalPrice || 0;

    // 注文内の全商品を集めて合計金額を計算（クーポン按分用）
    const allItems: Array<{
      manageNumber: string;
      skuId: string | null;
      itemName: string;
      units: number;
      itemGross: number;
    }> = [];
    let orderGoodsTotal = 0;

    for (const pkg of order.PackageModelList || []) {
      for (const item of pkg.ItemModelList || []) {
        const manageNumber = item.manageNumber || item.itemNumber || item.itemId || "unknown";
        const skuModel = item.SkuModelList?.[0];
        const skuId = skuModel?.merchantDefinedSkuId || skuModel?.variantId || null;
        const units = item.units || 1;
        const itemGross = (item.priceTaxIncl || item.price || 0) * units;

        allItems.push({ manageNumber, skuId, itemName: item.itemName || manageNumber, units, itemGross });
        orderGoodsTotal += itemGross;
      }
    }

    for (const item of allItems) {
      // クーポン割引を商品金額の比率で按分
      const couponShare = (couponTotal > 0 && orderGoodsTotal > 0)
        ? Math.round(couponTotal * (item.itemGross / orderGoodsTotal))
        : 0;
      const sales = item.itemGross - couponShare;

      // 商品管理番号 × 日付 で集約
      const mnKey = `${item.manageNumber}::${date}`;
      const existing = mnMap.get(mnKey);
      if (existing) {
        existing.orders += 1;
        existing.units_sold += item.units;
        existing.sales_amount += sales;
      } else {
        mnMap.set(mnKey, {
          manage_number: item.manageNumber,
          product_name: item.itemName,
          date,
          orders: 1,
          units_sold: item.units,
          sales_amount: sales,
        });
      }

      // SKU × 日付 で集約（原価計算用）
      const skuKey = `${item.manageNumber}::${item.skuId || ""}::${date}`;
      const existingSku = skuMap.get(skuKey);
      if (existingSku) {
        existingSku.orders += 1;
        existingSku.units_sold += item.units;
        existingSku.sales_amount += sales;
      } else {
        skuMap.set(skuKey, {
          manage_number: item.manageNumber,
          sku_id: item.skuId,
          date,
          orders: 1,
          units_sold: item.units,
          sales_amount: sales,
        });
      }
    }
  }

  return {
    byManageNumber: Array.from(mnMap.values()),
    bySku: Array.from(skuMap.values()),
  };
}

/**
 * 商品マスタをupsert（manageNumberをproduct_idとして登録）
 */
async function upsertProducts(entries: AggEntry[]): Promise<number> {
  const seen = new Set<string>();
  const newProducts: Array<{
    product_id: string;
    name: string;
    selling_price: number;
    cost_price: number;
    fee_rate: number;
    shipping_fee: number;
  }> = [];

  for (const entry of entries) {
    if (seen.has(entry.manage_number)) continue;
    seen.add(entry.manage_number);

    const avgPrice = entry.units_sold > 0
      ? Math.round(entry.sales_amount / entry.units_sold)
      : 0;

    newProducts.push({
      product_id: entry.manage_number,
      name: entry.product_name,
      selling_price: avgPrice,
      cost_price: 0,
      fee_rate: 10,
      shipping_fee: 0,
    });
  }

  if (newProducts.length === 0) return 0;

  // 既存商品をチェック
  const { data: existing } = await supabase
    .from("rakuten_products")
    .select("product_id");

  const existingIds = new Set((existing || []).map(p => p.product_id));
  const toInsert = newProducts.filter(p => !existingIds.has(p.product_id));

  if (toInsert.length > 0) {
    const { error } = await supabase
      .from("rakuten_products")
      .insert(toInsert);
    if (error) {
      console.error("楽天商品マスタ登録エラー:", error);
    }
  }

  return toInsert.length;
}

/**
 * 日別売上データをupsert（manageNumber → UUID変換）
 */
async function upsertDailySales(entries: AggEntry[]): Promise<number> {
  // manageNumber → UUID のマッピング取得
  const manageNumbers = [...new Set(entries.map(e => e.manage_number))];
  const { data: products } = await supabase
    .from("rakuten_products")
    .select("id, product_id")
    .in("product_id", manageNumbers);

  const idMap = new Map<string, string>(
    (products || []).map(p => [p.product_id, p.id])
  );

  let upserted = 0;

  for (const entry of entries) {
    const dbProductId = idMap.get(entry.manage_number);
    if (!dbProductId) {
      console.warn(`楽天商品マッチ失敗: ${entry.manage_number}`);
      continue;
    }

    // 既存レコードを確認（access_count/cvrを保持するため）
    const { data: existing } = await supabase
      .from("rakuten_daily_sales")
      .select("id, access_count, cvr")
      .eq("product_id", dbProductId)
      .eq("date", entry.date)
      .maybeSingle();

    let error;
    if (existing) {
      ({ error } = await supabase
        .from("rakuten_daily_sales")
        .update({
          orders: entry.orders,
          sales_amount: entry.sales_amount,
          units_sold: entry.units_sold,
          cancellations: 0,
          source: "api" as const,
        })
        .eq("id", existing.id));
    } else {
      ({ error } = await supabase
        .from("rakuten_daily_sales")
        .insert({
          product_id: dbProductId,
          date: entry.date,
          access_count: 0,
          orders: entry.orders,
          sales_amount: entry.sales_amount,
          units_sold: entry.units_sold,
          cvr: 0,
          cancellations: 0,
          source: "api" as const,
        }));
    }

    if (error) {
      console.error(`売上upsertエラー (${entry.manage_number} ${entry.date}):`, error);
    } else {
      upserted++;
    }
  }

  return upserted;
}

/**
 * SKU別日次売上をupsert（原価計算用）
 */
async function upsertDailySkuSales(entries: SkuEntry[]): Promise<number> {
  let upserted = 0;

  for (const entry of entries) {
    const { error } = await supabase
      .from("rakuten_daily_sku_sales")
      .upsert({
        manage_number: entry.manage_number,
        sku_id: entry.sku_id || "",
        date: entry.date,
        orders: entry.orders,
        units_sold: entry.units_sold,
        sales_amount: entry.sales_amount,
      }, {
        onConflict: "manage_number,COALESCE(sku_id, ''),date",
      });

    if (error) {
      // COALESCE付きのonConflictが使えない場合は手動upsert
      const { data: existing } = await supabase
        .from("rakuten_daily_sku_sales")
        .select("id")
        .eq("manage_number", entry.manage_number)
        .eq("sku_id", entry.sku_id || "")
        .eq("date", entry.date)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("rakuten_daily_sku_sales")
          .update({
            orders: entry.orders,
            units_sold: entry.units_sold,
            sales_amount: entry.sales_amount,
          })
          .eq("id", existing.id);
      } else {
        await supabase
          .from("rakuten_daily_sku_sales")
          .insert({
            manage_number: entry.manage_number,
            sku_id: entry.sku_id || "",
            date: entry.date,
            orders: entry.orders,
            units_sold: entry.units_sold,
            sales_amount: entry.sales_amount,
          });
      }
    }
    upserted++;
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

    // 2. 集約
    const { byManageNumber: allEntries, bySku: skuEntries } = aggregateOrders(orders);

    // 防御: 注文日が指定範囲外のエントリを除外
    const entries = allEntries.filter(e => {
      if (e.date < dateFrom || e.date > dateTo) {
        console.warn(`範囲外の注文日を除外: ${e.date} (指定範囲: ${dateFrom}〜${dateTo}), product=${e.manage_number}`);
        return false;
      }
      return true;
    });

    const filteredSkuEntries = skuEntries.filter(e =>
      e.date >= dateFrom && e.date <= dateTo
    );

    // 3. 商品マスタ登録
    const productsUpserted = await upsertProducts(entries);

    // 4. 日別売上データ登録
    const salesUpserted = await upsertDailySales(entries);

    // 5. SKU別売上データ登録（原価計算用）
    await upsertDailySkuSales(filteredSkuEntries);

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
