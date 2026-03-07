import { supabase } from "@/lib/supabase";
import { getOrders, getOrderItems, getFbaInventory } from "@/lib/amazon/sp-api";
import type { SpApiOrderItem } from "@/lib/amazon/sp-api";
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
// Orders → daily_sales sync
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

/**
 * Auto-create a product entry from SP-API order item data
 */
async function autoCreateProduct(
  asin: string,
  title: string,
  sku: string | null,
  price: number
): Promise<Product | null> {
  // Check if already exists (race condition protection)
  const { data: existing } = await supabase
    .from("products")
    .select("*")
    .eq("asin", asin)
    .eq("is_archived", false)
    .maybeSingle();

  if (existing) {
    return existing as Product;
  }

  const code = `AUTO-${asin}`;

  const { data, error } = await supabase
    .from("products")
    .insert({
      name: title || `商品 ${asin}`,
      code,
      asin,
      sku: sku || null,
      selling_price: price,
      cost_price: 0,
      fba_fee_rate: 15,
      category: null,
      is_archived: false,
    })
    .select()
    .single();

  if (error) {
    console.error(`[Auto-Create Product] Failed for ASIN ${asin}: ${error.message}`);
    return null;
  }

  console.log(`[Auto-Create Product] Created: ${title} (ASIN: ${asin}, ID: ${data.id})`);
  return data as Product;
}

/**
 * Sync orders from SP-API to daily_sales table
 * Auto-creates products for unknown ASINs found in orders
 */
export async function syncOrders(
  startDate: string,
  endDate: string
): Promise<SyncResult> {
  const errors: string[] = [];
  let recordsProcessed = 0;
  let autoCreatedProducts = 0;

  // 1. Fetch orders from SP-API FIRST
  console.log(`[SP-API Sync] Fetching orders from ${startDate} to ${endDate}...`);
  const orders = await getOrders(startDate, endDate);
  console.log(`[SP-API Sync] Orders returned: ${orders.length}`);

  if (orders.length === 0) {
    const { data: products } = await supabase
      .from("products")
      .select("id")
      .eq("is_archived", false);
    return {
      recordsProcessed: 0,
      errors: ["指定期間に注文がありませんでした"],
      debug: {
        totalProducts: products?.length || 0,
        productsWithAsin: 0,
        ordersFromApi: 0,
        autoCreatedProducts: 0,
      },
    };
  }

  // 2. Get existing products for ASIN mapping
  const { data: products } = await supabase
    .from("products")
    .select("id, asin, sku")
    .eq("is_archived", false);

  const asinToProduct = new Map<string, Product>();
  for (const p of (products || [])) {
    if (p.asin) asinToProduct.set(p.asin, p as Product);
  }

  console.log(`[SP-API Sync] Existing products: ${products?.length || 0}, with ASIN: ${asinToProduct.size}`);

  // 3. Process each order, auto-create products for unknown ASINs
  const aggregateMap = new Map<string, DailySalesAggregate>();

  for (const order of orders) {
    try {
      const items = await getOrderItems(order.AmazonOrderId);

      for (const item of items) {
        let product = asinToProduct.get(item.ASIN);

        // Auto-create product if ASIN is unknown
        if (!product) {
          console.log(`[SP-API Sync] Unknown ASIN ${item.ASIN}, auto-creating: ${item.Title}`);
          const price = item.ItemPrice ? Math.round(parseFloat(item.ItemPrice.Amount)) : 0;
          const newProduct = await autoCreateProduct(
            item.ASIN,
            item.Title,
            item.SellerSKU || null,
            price
          );

          if (newProduct) {
            asinToProduct.set(item.ASIN, newProduct);
            product = newProduct;
            autoCreatedProducts++;
          } else {
            errors.push(`商品自動登録失敗 ASIN: ${item.ASIN}`);
            continue;
          }
        }

        const date = order.PurchaseDate.split("T")[0];
        const key = `${product.id}_${date}`;
        const amount = item.ItemPrice
          ? Math.round(parseFloat(item.ItemPrice.Amount))
          : 0;
        const isCancelled = order.OrderStatus === "Canceled";

        const existing = aggregateMap.get(key) || {
          product_id: product.id,
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
          existing.cancellations += item.QuantityOrdered;
        } else {
          existing.orders += 1;
          existing.units_sold += item.QuantityOrdered;
          existing.sales_amount += amount;
        }

        aggregateMap.set(key, existing);
      }
    } catch (err) {
      errors.push(
        `注文処理エラー ${order.AmazonOrderId}: ${err instanceof Error ? err.message : "Unknown"}`
      );
    }
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

  const totalProducts = (products?.length || 0) + autoCreatedProducts;

  if (autoCreatedProducts > 0) {
    errors.unshift(`${autoCreatedProducts}件の商品を自動登録しました`);
  }

  return {
    recordsProcessed,
    errors,
    debug: {
      totalProducts,
      productsWithAsin: asinToProduct.size,
      ordersFromApi: orders.length,
      autoCreatedProducts,
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
