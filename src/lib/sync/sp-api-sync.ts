import { supabase } from "@/lib/supabase";
import { getOrders, getOrderItems, getFbaInventory, downloadSalesTrafficReport, getCatalogItemBSR, getListingsReportDebugInfo } from "@/lib/amazon/sp-api";
import type { SpApiOrder } from "@/lib/amazon/sp-api";
import type { Product } from "@/types/database";

interface SyncResult {
  recordsProcessed: number;
  errors: string[];
  debug?: {
    totalProducts: number;
    productsWithAsin: number;
    ordersFromApi: number;
    inventoryFromApi?: number;
    autoCreatedProducts?: number;
  };
}

// ============================================
// Orders → daily_sales sync (FAST MODE)
// ============================================
// Uses order-level OrderTotal instead of per-order getOrderItems calls
// This is ~30x faster: 1 API call for 100 orders vs 100+ individual calls

interface DailySalesAggregate {
  product_id: string;
  date: string;
  sessions: number;
  orders: number;
  sales_amount: number;
  units_sold: number;
  cancellations: number;
  cvr: number;
  source: "sp-api";
}

/**
 * Get or create a catch-all product for order-level sync
 * Used when we don't have per-item ASIN data (fast mode)
 */
async function getOrCreateCatchAllProduct(): Promise<Product | null> {
  const CATCH_ALL_CODE = "SP-API-ALL";

  const { data: existing } = await supabase
    .from("products")
    .select("*")
    .eq("code", CATCH_ALL_CODE)
    .eq("is_archived", false)
    .maybeSingle();

  if (existing) return existing as Product;

  const { data, error } = await supabase
    .from("products")
    .insert({
      name: "Amazon売上（全商品）",
      code: CATCH_ALL_CODE,
      asin: null,
      sku: null,
      selling_price: 0,
      cost_price: 0,
      fba_fee_rate: 15,
      category: null,
      is_archived: false,
    })
    .select()
    .single();

  if (error) {
    console.error(`[Catch-All Product] Failed to create: ${error.message}`);
    return null;
  }

  return data as Product;
}

/**
 * Sync orders from SP-API to daily_sales table (FAST MODE)
 * Uses order-level OrderTotal — no per-order getOrderItems calls
 * Aggregates all orders into a single catch-all product per day
 */
export async function syncOrders(
  startDate: string,
  endDate: string
): Promise<SyncResult> {
  const errors: string[] = [];
  let recordsProcessed = 0;

  // 1. Fetch orders from SP-API (single paginated API call, very fast)
  console.log(`[SP-API Sync] Fetching orders from ${startDate} to ${endDate}...`);
  const orders = await getOrders(startDate, endDate);
  console.log(`[SP-API Sync] Orders returned: ${orders.length}`);

  if (orders.length === 0) {
    return {
      recordsProcessed: 0,
      errors: ["指定期間に注文がありませんでした"],
      debug: {
        totalProducts: 0,
        productsWithAsin: 0,
        ordersFromApi: 0,
        autoCreatedProducts: 0,
      },
    };
  }

  // 2. Get or create catch-all product for fast aggregation
  const catchAllProduct = await getOrCreateCatchAllProduct();
  if (!catchAllProduct) {
    return {
      recordsProcessed: 0,
      errors: ["キャッチオール商品の作成に失敗しました"],
      debug: { totalProducts: 0, productsWithAsin: 0, ordersFromApi: orders.length, autoCreatedProducts: 0 },
    };
  }

  // 3. Aggregate orders by date (no per-order API calls needed!)
  const aggregateMap = new Map<string, DailySalesAggregate>();

  for (const order of orders) {
    // Convert UTC PurchaseDate to JST (UTC+9) before extracting date,
    // so bucketing matches Amazon Seller Central which displays in JST
    const purchaseDateJST = new Date(new Date(order.PurchaseDate).getTime() + 9 * 60 * 60 * 1000);
    const date = purchaseDateJST.toISOString().split("T")[0];
    const key = `${catchAllProduct.id}_${date}`;
    const amount = order.OrderTotal
      ? Math.round(parseFloat(order.OrderTotal.Amount))
      : 0;
    const units = order.NumberOfItemsShipped + order.NumberOfItemsUnshipped;
    const isCancelled = order.OrderStatus === "Canceled";

    const existing = aggregateMap.get(key) || {
      product_id: catchAllProduct.id,
      date,
      sessions: 0,
      orders: 0,
      sales_amount: 0,
      units_sold: 0,
      cancellations: 0,
      cvr: 0,
      source: "sp-api" as const,
    };

    if (isCancelled) {
      existing.cancellations += units || 1;
    } else {
      existing.orders += 1;
      existing.units_sold += units;
      existing.sales_amount += amount;
    }

    aggregateMap.set(key, existing);
  }

  // 4. Upsert aggregated data to daily_sales
  const records = Array.from(aggregateMap.values());

  for (const record of records) {
    const { error } = await supabase.from("daily_sales").upsert(record, {
      onConflict: "product_id,date",
    });

    if (error) {
      errors.push(`売上保存失敗 ${record.date}: ${error.message}`);
    } else {
      recordsProcessed++;
    }
  }

  return {
    recordsProcessed,
    errors,
    debug: {
      totalProducts: 1,
      productsWithAsin: 0,
      ordersFromApi: orders.length,
      autoCreatedProducts: catchAllProduct ? 1 : 0,
    },
  };
}

// ============================================
// FBA Inventory → inventory sync
// ============================================

/**
 * Sync FBA inventory levels to inventory table
 */
export async function syncInventory(): Promise<SyncResult> {
  const errors: string[] = [];
  let recordsProcessed = 0;

  // 1. Get all products for ASIN mapping
  const { data: products } = await supabase
    .from("products")
    .select("id, asin")
    .eq("is_archived", false);

  const totalProducts = products?.length || 0;

  if (!products || products.length === 0) {
    return {
      recordsProcessed: 0,
      errors: ["商品マスタが空です。先に売上データ同期を実行して商品を自動登録してください。"],
      debug: { totalProducts: 0, productsWithAsin: 0, ordersFromApi: 0, inventoryFromApi: 0 },
    };
  }

  const asinToProductId = new Map<string, string>();
  for (const p of products) {
    if (p.asin) asinToProductId.set(p.asin, p.id);
  }

  const productsWithAsin = asinToProductId.size;
  console.log(`[SP-API Inventory] Products: ${totalProducts}, with ASIN: ${productsWithAsin}`);

  if (productsWithAsin === 0) {
    return {
      recordsProcessed: 0,
      errors: ["ASINが設定された商品がありません。先に売上データ同期を実行してください。"],
      debug: { totalProducts, productsWithAsin: 0, ordersFromApi: 0, inventoryFromApi: 0 },
    };
  }

  // 2. Fetch FBA inventory
  console.log(`[SP-API Inventory] Fetching FBA inventory...`);
  const inventoryItems = await getFbaInventory();
  console.log(`[SP-API Inventory] Items returned: ${inventoryItems.length}`);

  // 3. Update inventory for each item
  for (const item of inventoryItems) {
    const productId = asinToProductId.get(item.asin);
    if (!productId) continue;

    const newStock = item.inventoryDetails.fulfillableQuantity;

    // Get current stock to calculate change
    const { data: currentInv } = await supabase
      .from("inventory")
      .select("current_stock")
      .eq("product_id", productId)
      .single();

    const oldStock = currentInv?.current_stock || 0;
    const stockChange = newStock - oldStock;

    // Upsert inventory
    const { error } = await supabase.from("inventory").upsert(
      {
        product_id: productId,
        current_stock: newStock,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "product_id" }
    );

    if (error) {
      errors.push(`在庫更新失敗 ASIN ${item.asin}: ${error.message}`);
      continue;
    }

    // Log inventory change if different
    if (stockChange !== 0) {
      await supabase.from("inventory_logs").insert({
        product_id: productId,
        date: new Date().toISOString().split("T")[0],
        change_amount: stockChange,
        change_type: "adjustment",
        notes: `SP-API sync: ${oldStock} → ${newStock}`,
      });
    }

    recordsProcessed++;
  }

  return {
    recordsProcessed,
    errors,
    debug: {
      totalProducts,
      productsWithAsin,
      ordersFromApi: 0,
      inventoryFromApi: inventoryItems.length,
    },
  };
}

// ============================================
// Traffic (Sessions) → daily_sales update
// ============================================

/**
 * Sync traffic/session data from SP-API Reports to daily_sales table
 * Uses GET_SALES_AND_TRAFFIC_REPORT to get browser sessions per ASIN per day
 */
export async function syncTraffic(
  startDate: string,
  endDate: string
): Promise<SyncResult> {
  const errors: string[] = [];
  let recordsProcessed = 0;

  try {
    // 1. Get all products for ASIN mapping
    const { data: products } = await supabase
      .from("products")
      .select("id, asin")
      .eq("is_archived", false);

    if (!products || products.length === 0) {
      return { recordsProcessed: 0, errors: ["No products found"] };
    }

    const asinToProductId = new Map<string, string>();
    for (const p of products) {
      if (p.asin) asinToProductId.set(p.asin, p.id);
    }

    // 2. Generate list of dates to process
    const dates: string[] = [];
    const current = new Date(startDate + "T00:00:00Z");
    const end = new Date(endDate + "T00:00:00Z");
    while (current <= end) {
      dates.push(current.toISOString().split("T")[0]);
      current.setUTCDate(current.getUTCDate() + 1);
    }

    console.log(`[SP-API Traffic] Processing ${dates.length} days from ${startDate} to ${endDate}`);

    // 3. Process each day individually (1 report per day = per-ASIN daily data)
    // Track previous day's data to detect duplicate responses from SP-API
    let prevDayFingerprint = "";

    for (const date of dates) {
      try {
        const trafficRows = await downloadSalesTrafficReport(date, date);

        if (trafficRows.length === 0) {
          console.log(`[SP-API Traffic] No data for ${date}`);
          continue;
        }

        // Aggregate sales + sessions by product_id for this date
        const dataMap = new Map<string, { sessions: number; orders: number; sales_amount: number; units_sold: number }>();

        for (const row of trafficRows) {
          const productId = asinToProductId.get(row.childAsin) || asinToProductId.get(row.parentAsin);
          if (!productId) continue;

          const existing = dataMap.get(productId) || { sessions: 0, orders: 0, sales_amount: 0, units_sold: 0 };
          existing.sessions += row.browserSessions;
          existing.orders += row.totalOrderItems;
          existing.sales_amount += Math.round(row.orderedProductSales);
          existing.units_sold += row.unitsOrdered;
          dataMap.set(productId, existing);
        }

        // Duplicate detection: create a fingerprint of this day's data
        // If identical to previous day, SP-API likely returned cached/aggregated data
        const fingerprint = Array.from(dataMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([pid, d]) => `${pid}:${d.sales_amount}:${d.units_sold}:${d.orders}`)
          .join("|");

        if (fingerprint === prevDayFingerprint && fingerprint !== "") {
          console.warn(
            `[SP-API Traffic] WARNING: ${date} has identical data to previous day — ` +
            `SP-API may be returning cached/aggregated data. Skipping to avoid duplicates.`
          );
          errors.push(`${date}: Skipped — identical to previous day (possible SP-API cache issue)`);
          continue;
        }
        prevDayFingerprint = fingerprint;

        // Upsert daily_sales records for this date (with full sales data)
        for (const [productId, data] of dataMap) {
          const { error } = await supabase.from("daily_sales").upsert(
            {
              product_id: productId,
              date: date,
              sessions: data.sessions,
              orders: data.orders,
              sales_amount: data.sales_amount,
              units_sold: data.units_sold,
              cvr: data.sessions > 0 ? Math.round((data.units_sold / data.sessions) * 10000) / 100 : 0,
              cancellations: 0,
              source: "csv",
            },
            { onConflict: "product_id,date" }
          );

          if (error) {
            errors.push(`Failed to upsert ${date}: ${error.message}`);
          } else {
            recordsProcessed++;
          }
        }

        console.log(`[SP-API Traffic] ${date}: ${dataMap.size} products with sales data`);

      } catch (dayError) {
        const msg = dayError instanceof Error ? dayError.message : String(dayError);
        errors.push(`Traffic sync error for ${date}: ${msg}`);
        console.error(`[SP-API Traffic] Error for ${date}:`, msg);
      }
    }

    console.log(`[SP-API Traffic] Updated ${recordsProcessed} records with session data`);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    errors.push(`Traffic sync error: ${msg}`);
  }

  return { recordsProcessed, errors };
}

// ============================================
// BSR Rankings → bsr_rankings sync
// ============================================

function bsrSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sync BSR (Best Sellers Rank) for all active products with ASINs
 */
export async function syncBSR(): Promise<SyncResult> {
  const errors: string[] = [];
  let recordsProcessed = 0;

  // 1. Get all active products with ASINs
  const { data: products } = await supabase
    .from("products")
    .select("id, asin, name")
    .eq("is_archived", false)
    .not("asin", "is", null);

  if (!products || products.length === 0) {
    return {
      recordsProcessed: 0,
      errors: ["ASINが設定された商品がありません"],
    };
  }

  console.log(`[SP-API BSR] Fetching BSR for ${products.length} products`);

  // 2. Fetch BSR for each product
  for (const product of products) {
    if (!product.asin) continue;

    try {
      const bsrData = await getCatalogItemBSR(product.asin);

      if (bsrData && bsrData.rankings.length > 0) {
        // Insert all rankings for this product
        for (const ranking of bsrData.rankings) {
          const { error } = await supabase.from("bsr_rankings").insert({
            product_id: product.id,
            asin: product.asin,
            category_id: ranking.categoryId,
            category_name: ranking.categoryName,
            rank: ranking.rank,
            recorded_at: new Date().toISOString(),
          });

          if (error) {
            errors.push(`BSR保存失敗 ${product.asin} (${ranking.categoryName}): ${error.message}`);
          } else {
            recordsProcessed++;
          }
        }

        console.log(`[SP-API BSR] ${product.name}: ${bsrData.rankings.map(r => `#${r.rank} in ${r.categoryName}`).join(", ")}`);
      } else if (bsrData) {
        errors.push(`${product.asin} (${product.name}): BSRデータ取得成功だがランキング0件`);
        console.log(`[SP-API BSR] ${product.name}: API returned OK but 0 rankings`);
      }

      // Rate limit: 1 second between products
      await bsrSleep(1000);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`BSR取得失敗 ${product.asin}: ${msg}`);
    }
  }

  const debugInfo = getListingsReportDebugInfo();
  console.log(`[SP-API BSR] Synced ${recordsProcessed} BSR records. Report debug: ${debugInfo}`);
  return {
    recordsProcessed,
    errors,
    debug: {
      totalProducts: products.length,
      productsWithAsin: products.filter(p => p.asin).length,
      ordersFromApi: 0,
      listingsReportDebug: debugInfo,
    } as SyncResult["debug"] & { listingsReportDebug: string },
  };
}
