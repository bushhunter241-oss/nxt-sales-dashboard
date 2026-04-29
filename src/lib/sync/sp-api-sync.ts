import { getSupabaseAdmin } from "@/lib/supabase";
import { getOrders, getOrderItems, getFbaInventory, downloadSalesTrafficReport, getCatalogItemBSR, getListingsReportDebugInfo, getFbaFeeEstimate } from "@/lib/amazon/sp-api";
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
    matchedOrders?: number;
    pendingOrders?: number;
    pendingAmount?: number;
    unmatchedAsins?: string[];
  };
}

// ============================================
// Orders → daily_sales sync (ASIN-based matching)
// ============================================

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

function syncSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sync orders from SP-API to daily_sales table (ASIN-based matching)
 * Fetches order items per order to get ASIN, then matches to products table.
 * Auto-creates products for unknown ASINs.
 */
export async function syncOrders(
  startDate: string,
  endDate: string
): Promise<SyncResult> {
  const db = getSupabaseAdmin();
  const errors: string[] = [];
  let recordsProcessed = 0;
  let autoCreatedProducts = 0;

  // 1. Fetch orders from SP-API
  console.log(`[SP-API Sync] Fetching orders from ${startDate} to ${endDate}...`);
  const orders = await getOrders(startDate, endDate);
  console.log(`[SP-API Sync] Orders returned: ${orders.length}`);

  if (orders.length === 0) {
    return {
      recordsProcessed: 0,
      errors: ["指定期間に注文がありませんでした"],
      debug: { totalProducts: 0, productsWithAsin: 0, ordersFromApi: 0, autoCreatedProducts: 0, matchedOrders: 0 },
    };
  }

  // 2. Load existing products (ASIN→product mapping)
  const { data: products } = await db
    .from("products")
    .select("id, asin, sku, name, fba_shipping_fee, selling_price")
    .eq("is_archived", false);

  const asinToProduct = new Map<string, { id: string; name: string; fba_shipping_fee: number }>();
  const skuToProduct = new Map<string, { id: string; name: string; fba_shipping_fee: number }>();
  for (const p of products || []) {
    if (p.asin) asinToProduct.set(p.asin, { id: p.id, name: p.name, fba_shipping_fee: p.fba_shipping_fee || 0 });
    if (p.sku) skuToProduct.set(p.sku, { id: p.id, name: p.name, fba_shipping_fee: p.fba_shipping_fee || 0 });
  }

  console.log(`[SP-API Sync] Products loaded: ${products?.length || 0} (ASIN mapped: ${asinToProduct.size}, SKU mapped: ${skuToProduct.size})`);

  // 3. Fetch order items for each order and aggregate by product+date
  const aggregateMap = new Map<string, DailySalesAggregate>();
  const unmatchedAsins = new Set<string>();
  const feeUpdatedAsins = new Set<string>();
  let matchedOrders = 0;
  let pendingCount = 0;
  let pendingAmount = 0;

  for (const order of orders) {
    const isCancelled = order.OrderStatus === "Canceled";
    const isPending = order.OrderStatus === "Pending";

    // Convert PurchaseDate to JST for bucketing
    const purchaseDateJST = new Date(new Date(order.PurchaseDate).getTime() + 9 * 60 * 60 * 1000);
    const date = purchaseDateJST.toISOString().split("T")[0];

    // Pending注文はOrderItemsが取得できない（SP-API制限）
    // 支払い確認後に Unshipped/Shipped に変わるので次回syncで取得される
    if (isPending) {
      pendingCount++;
      const orderTotal = order.OrderTotal ? Math.round(parseFloat(order.OrderTotal.Amount)) : 0;
      pendingAmount += orderTotal;
      continue;
    }

    try {
      const items = await getOrderItems(order.AmazonOrderId);

      for (const item of items) {
        // Match by ASIN first, then SKU
        let matched = asinToProduct.get(item.ASIN) || skuToProduct.get(item.SellerSKU);
        const itemPrice = item.ItemPrice ? Math.round(parseFloat(item.ItemPrice.Amount)) : 0;

        // Auto-create product if not found
        if (!matched) {
          // Estimate FBA fees before creating
          let fbaShippingFee = 0;
          const feeEstimate = await getFbaFeeEstimate(item.ASIN, itemPrice || 3000);
          if (feeEstimate) {
            fbaShippingFee = feeEstimate.FBAFulfillmentFeePerUnit;
            console.log(`[SP-API Sync] Fee estimate for ${item.ASIN}: FBA=¥${fbaShippingFee}`);
          }
          await syncSleep(350);

          const { data: newProduct, error: createErr } = await db
            .from("products")
            .insert({
              name: (item.Title || item.ASIN).slice(0, 100),
              code: item.SellerSKU || item.ASIN,
              asin: item.ASIN,
              sku: item.SellerSKU || null,
              selling_price: itemPrice,
              cost_price: 0,
              fba_fee_rate: 15,
              fba_shipping_fee: fbaShippingFee,
              category: null,
              is_archived: false,
            })
            .select("id, name")
            .single();

          if (createErr) {
            errors.push(`商品自動作成失敗 ${item.ASIN}: ${createErr.message}`);
            unmatchedAsins.add(item.ASIN);
            continue;
          }

          matched = { id: newProduct.id, name: newProduct.name, fba_shipping_fee: fbaShippingFee };
          asinToProduct.set(item.ASIN, matched);
          if (item.SellerSKU) skuToProduct.set(item.SellerSKU, matched);
          feeUpdatedAsins.add(item.ASIN);
          autoCreatedProducts++;
          console.log(`[SP-API Sync] Auto-created product: ${matched.name} (${item.ASIN}) FBA=¥${fbaShippingFee}/個`);
        }

        // Update FBA fee for existing products with fba_shipping_fee=0 (once per ASIN)
        if (matched.fba_shipping_fee === 0 && !feeUpdatedAsins.has(item.ASIN)) {
          feeUpdatedAsins.add(item.ASIN);
          const price = itemPrice || (products || []).find(p => p.asin === item.ASIN)?.selling_price || 3000;
          const feeEstimate = await getFbaFeeEstimate(item.ASIN, price);
          if (feeEstimate && feeEstimate.FBAFulfillmentFeePerUnit > 0) {
            await db
              .from("products")
              .update({ fba_shipping_fee: feeEstimate.FBAFulfillmentFeePerUnit })
              .eq("id", matched.id);
            matched.fba_shipping_fee = feeEstimate.FBAFulfillmentFeePerUnit;
            console.log(`[SP-API Sync] Updated FBA fee for ${matched.name}: ¥${feeEstimate.FBAFulfillmentFeePerUnit}/個`);
          }
          await syncSleep(350);
        }

        const key = `${matched.id}_${date}`;
        const amount = item.ItemPrice ? Math.round(parseFloat(item.ItemPrice.Amount)) : 0;
        const units = item.QuantityOrdered || 1;

        const existing = aggregateMap.get(key) || {
          product_id: matched.id,
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
          existing.cancellations += units;
        } else {
          existing.orders += 1;
          existing.units_sold += units;
          existing.sales_amount += amount;
        }

        aggregateMap.set(key, existing);
        matchedOrders++;
      }

      // Rate limit: SP-API getOrderItems is 1 req/s burst
      await syncSleep(350);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`注文明細取得失敗 ${order.AmazonOrderId}: ${msg}`);
    }
  }

  // 4. Save aggregated data to daily_sales (preserve existing sessions from traffic sync)
  const records = Array.from(aggregateMap.values());

  for (const record of records) {
    // Check if a row already exists (may have sales data from traffic sync)
    const { data: existing } = await db
      .from("daily_sales")
      .select("id, sessions, sales_amount, source")
      .eq("product_id", record.product_id)
      .eq("date", record.date)
      .maybeSingle();

    let error;
    if (existing) {
      // Traffic sync (Sales & Traffic Report) is the authoritative source for sales figures.
      // Only update cancellations here; preserve sales_amount/orders/units_sold already set by traffic sync.
      // If traffic sync has not run yet (sales_amount=0), write the Orders API values as a placeholder.
      const trafficAlreadySet = existing.sales_amount > 0;
      const updatePayload = trafficAlreadySet
        ? { cancellations: record.cancellations }
        : {
            orders: record.orders,
            sales_amount: record.sales_amount,
            units_sold: record.units_sold,
            cancellations: record.cancellations,
            source: "sp-api" as const,
          };
      ({ error } = await db
        .from("daily_sales")
        .update(updatePayload)
        .eq("id", existing.id));
    } else {
      // No existing row, insert full record (traffic sync will overwrite later)
      ({ error } = await db.from("daily_sales").insert(record));
    }

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
      totalProducts: products?.length || 0,
      productsWithAsin: asinToProduct.size,
      ordersFromApi: orders.length,
      autoCreatedProducts,
      matchedOrders,
      pendingOrders: pendingCount,
      pendingAmount,
      unmatchedAsins: Array.from(unmatchedAsins),
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
  const db = getSupabaseAdmin();
  const errors: string[] = [];
  let recordsProcessed = 0;

  // 1. Get all products for ASIN mapping
  const { data: products } = await db
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
    const { data: currentInv } = await db
      .from("inventory")
      .select("current_stock")
      .eq("product_id", productId)
      .single();

    const oldStock = currentInv?.current_stock || 0;
    const stockChange = newStock - oldStock;

    // Upsert inventory
    const { error } = await db.from("inventory").upsert(
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
      await db.from("inventory_logs").insert({
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
  const db = getSupabaseAdmin();
  const errors: string[] = [];
  let recordsProcessed = 0;

  try {
    // 1. Get all products for ASIN mapping
    const { data: products } = await db
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

        // Save daily_sales records for this date (preserve cancellations from orders sync)
        for (const [productId, data] of dataMap) {
          const cvr = data.sessions > 0 ? Math.round((data.units_sold / data.sessions) * 10000) / 100 : 0;

          const { data: existing } = await db
            .from("daily_sales")
            .select("id")
            .eq("product_id", productId)
            .eq("date", date)
            .maybeSingle();

          let error;
          if (existing) {
            // Update traffic fields, preserve cancellations from orders sync
            ({ error } = await db
              .from("daily_sales")
              .update({
                sessions: data.sessions,
                orders: data.orders,
                sales_amount: data.sales_amount,
                units_sold: data.units_sold,
                cvr,
              })
              .eq("id", existing.id));
          } else {
            ({ error } = await db.from("daily_sales").insert({
              product_id: productId,
              date,
              sessions: data.sessions,
              orders: data.orders,
              sales_amount: data.sales_amount,
              units_sold: data.units_sold,
              cvr,
              cancellations: 0,
              source: "sp-api",
            }));
          }

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

      // Reports API createReport rate limit is 0.0167 req/s (1 per minute).
      // Wait 62s between days to stay within the limit on multi-day ranges.
      if (dates.indexOf(date) < dates.length - 1) {
        await syncSleep(62000);
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
  const db = getSupabaseAdmin();
  const errors: string[] = [];
  let recordsProcessed = 0;

  // 1. Get all active products with ASINs (excluding parent ASINs)
  // 親ASINに対する Catalog Items API は salesRanks を返さず 403 になるため除外。
  // バリエーションファミリーのBSRは子ASIN単位で別途取得される。
  // is_parent が NULL のレコード（カラム未設定の旧データ等）はフォールバックで含める。
  const { data: products } = await db
    .from("products")
    .select("id, asin, name")
    .eq("is_archived", false)
    .not("asin", "is", null)
    .or("is_parent.is.null,is_parent.eq.false");

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
          const { error } = await db.from("bsr_rankings").insert({
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
