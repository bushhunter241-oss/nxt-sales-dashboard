/**
 * 楽天売上データ取得・利益計算（v2: manageNumberベース）
 *
 * 利益計算式: 純利益 = 売上 − 手数料(売上×10%) − 原価 − 送料 − RPP広告費
 * 原価・送料はSKU別コストテーブルがあればSKU別計算、なければ商品マスタのデフォルト値
 */

import { supabase } from "@/lib/supabase";
import { RakutenDailySales } from "@/types/database";

export async function getRakutenDailySales(params: {
  startDate?: string;
  endDate?: string;
  productId?: string;
}) {
  let query = supabase
    .from("rakuten_daily_sales")
    .select("*, rakuten_product:rakuten_products(*)")
    .order("date", { ascending: false });

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);
  if (params.productId) query = query.eq("product_id", params.productId);

  const { data, error } = await query;
  if (error) { console.warn("getRakutenDailySales error:", error); return []; }
  return (data || []).filter((r: any) => !r.rakuten_product?.is_archived);
}

export async function getAggregatedRakutenDailySales(params: {
  startDate?: string;
  endDate?: string;
}) {
  let query = supabase
    .from("rakuten_daily_sales")
    .select("date, access_count, orders, sales_amount, units_sold, product_id, rakuten_product:rakuten_products(is_archived)")
    .order("date", { ascending: true });

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) { console.warn("getAggregatedRakutenDailySales error:", error); return []; }

  const grouped = (data || []).reduce((acc: Record<string, any>, row: any) => {
    if (row.rakuten_product?.is_archived) return acc;
    if (!acc[row.date]) {
      acc[row.date] = { date: row.date, access_count: 0, orders: 0, sales_amount: 0, units_sold: 0 };
    }
    acc[row.date].access_count += row.access_count;
    acc[row.date].orders += row.orders;
    acc[row.date].sales_amount += row.sales_amount;
    acc[row.date].units_sold += row.units_sold;
    return acc;
  }, {});

  return Object.values(grouped);
}

/**
 * 商品管理番号ごとのSKU数を取得
 */
export async function getRakutenSkuCounts(): Promise<Record<string, number>> {
  const { data } = await supabase
    .from("rakuten_sku_costs")
    .select("manage_number");

  const counts: Record<string, number> = {};
  for (const row of data || []) {
    counts[row.manage_number] = (counts[row.manage_number] || 0) + 1;
  }
  return counts;
}

/**
 * SKU別売上サマリーを取得（商品詳細展開用）
 */
export async function getRakutenSkuSalesSummary(params: {
  manageNumber: string;
  startDate?: string;
  endDate?: string;
}) {
  let skuQuery = supabase
    .from("rakuten_daily_sku_sales")
    .select("sku_id, units_sold, sales_amount")
    .eq("manage_number", params.manageNumber);

  if (params.startDate) skuQuery = skuQuery.gte("date", params.startDate);
  if (params.endDate) skuQuery = skuQuery.lte("date", params.endDate);

  const { data: skuSales } = await skuQuery;

  // SKU別コスト取得
  const { data: skuCosts } = await supabase
    .from("rakuten_sku_costs")
    .select("sku_id, sku_label, cost_price, shipping_fee")
    .eq("manage_number", params.manageNumber);

  const costMap = new Map(
    (skuCosts || []).map(c => [c.sku_id, c])
  );

  // SKU別集計
  const skuMap = new Map<string, {
    sku_id: string;
    sku_label: string;
    units_sold: number;
    sales_amount: number;
    cost: number;
    shipping: number;
  }>();

  for (const s of skuSales || []) {
    const key = s.sku_id || "(不明)";
    const existing = skuMap.get(key);
    const costInfo = costMap.get(s.sku_id || "");
    const unitCost = costInfo?.cost_price || 0;
    const unitShipping = costInfo?.shipping_fee || 0;

    if (existing) {
      existing.units_sold += s.units_sold;
      existing.sales_amount += s.sales_amount;
      existing.cost += unitCost * s.units_sold;
      existing.shipping += unitShipping * s.units_sold;
    } else {
      skuMap.set(key, {
        sku_id: key,
        sku_label: costInfo?.sku_label || key,
        units_sold: s.units_sold,
        sales_amount: s.sales_amount,
        cost: unitCost * s.units_sold,
        shipping: unitShipping * s.units_sold,
      });
    }
  }

  return Array.from(skuMap.values()).sort((a, b) => b.sales_amount - a.sales_amount);
}

export async function getRakutenDailyAdSpendByDate(params: {
  startDate?: string;
  endDate?: string;
}) {
  let query = supabase
    .from("rakuten_daily_advertising")
    .select("date, ad_spend");

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) { console.warn("getRakutenDailyAdSpendByDate error:", error); return {}; }

  const byDate: Record<string, number> = {};
  for (const row of data || []) {
    byDate[row.date] = (byDate[row.date] || 0) + row.ad_spend;
  }
  return byDate;
}

export async function upsertRakutenDailySales(sales: Omit<RakutenDailySales, "id" | "created_at">) {
  const { data, error } = await supabase
    .from("rakuten_daily_sales")
    .upsert(sales, { onConflict: "product_id,date" })
    .select()
    .single();
  if (error) throw error;
  return data as RakutenDailySales;
}

export async function updateRakutenAccessData(params: {
  productId: string;
  date: string;
  accessCount: number;
  cvr: number;
}) {
  const { data: existing } = await supabase
    .from("rakuten_daily_sales")
    .select("id")
    .eq("product_id", params.productId)
    .eq("date", params.date)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("rakuten_daily_sales")
      .update({ access_count: params.accessCount, cvr: params.cvr })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from("rakuten_daily_sales")
      .insert({
        product_id: params.productId,
        date: params.date,
        access_count: params.accessCount,
        orders: 0,
        sales_amount: 0,
        units_sold: 0,
        cvr: params.cvr,
        cancellations: 0,
        source: "csv" as const,
      });
    if (error) throw error;
  }
}

/**
 * 施策カレンダーのセールイベントmemoから割引率(%)を抽出
 */
function parseDiscountRate(memo: string): number {
  const match = memo.match(/(\d+)%/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * SKU別コストを取得し、商品管理番号ごとの原価・送料を計算
 */
async function getSkuCostsByProduct(
  productIds: string[],
  startDate?: string,
  endDate?: string,
): Promise<Map<string, { total_cost: number; total_shipping: number }>> {
  // product UUID → product_id(manageNumber) のマッピング
  const { data: products } = await supabase
    .from("rakuten_products")
    .select("id, product_id")
    .in("id", productIds);

  const uuidToMn = new Map<string, string>(
    (products || []).map(p => [p.id, p.product_id])
  );
  const manageNumbers = [...new Set((products || []).map(p => p.product_id))];

  // SKU別コストを取得
  const { data: skuCosts } = await supabase
    .from("rakuten_sku_costs")
    .select("manage_number, sku_id, cost_price, shipping_fee")
    .in("manage_number", manageNumbers);

  const costMap = new Map<string, Map<string, { cost_price: number; shipping_fee: number }>>();
  for (const sc of skuCosts || []) {
    if (!costMap.has(sc.manage_number)) costMap.set(sc.manage_number, new Map());
    costMap.get(sc.manage_number)!.set(sc.sku_id, {
      cost_price: sc.cost_price,
      shipping_fee: sc.shipping_fee,
    });
  }

  // SKU別日次売上を取得
  let skuQuery = supabase
    .from("rakuten_daily_sku_sales")
    .select("manage_number, sku_id, units_sold")
    .in("manage_number", manageNumbers);

  if (startDate) skuQuery = skuQuery.gte("date", startDate);
  if (endDate) skuQuery = skuQuery.lte("date", endDate);

  const { data: skuSales } = await skuQuery;

  // manageNumber別にSKUコスト合計を計算
  const result = new Map<string, { total_cost: number; total_shipping: number }>();
  for (const ss of skuSales || []) {
    const skuCostMap = costMap.get(ss.manage_number);
    const skuCost = skuCostMap?.get(ss.sku_id || "");
    if (skuCost) {
      const mn = ss.manage_number;
      const existing = result.get(mn) || { total_cost: 0, total_shipping: 0 };
      existing.total_cost += skuCost.cost_price * ss.units_sold;
      existing.total_shipping += skuCost.shipping_fee * ss.units_sold;
      result.set(mn, existing);
    }
  }

  // UUID → manageNumber → result のマッピングを UUID → result に変換
  const uuidResult = new Map<string, { total_cost: number; total_shipping: number }>();
  for (const [uuid, mn] of uuidToMn) {
    const costs = result.get(mn);
    if (costs) uuidResult.set(uuid, costs);
  }

  return uuidResult;
}

/**
 * 日別×SKU別の正確な原価・送料を取得。
 * rakuten_daily_sku_sales (日別×SKU別販売数) + rakuten_sku_costs (SKU別原価) で集計し、
 * date → { cost, shipping } のマップを返す。
 */
export async function getRakutenDailyCostBreakdown(params: {
  startDate?: string;
  endDate?: string;
}): Promise<Record<string, { cost: number; shipping: number }>> {
  // SKU別原価を全件取得
  const { data: skuCosts } = await supabase
    .from("rakuten_sku_costs")
    .select("manage_number, sku_id, cost_price, shipping_fee");

  const costMap = new Map<string, { cost_price: number; shipping_fee: number }>();
  for (const sc of skuCosts || []) {
    costMap.set(`${sc.manage_number}::${sc.sku_id}`, {
      cost_price: sc.cost_price,
      shipping_fee: sc.shipping_fee,
    });
  }

  // 日別×SKU別販売数を取得
  let skuQuery = supabase
    .from("rakuten_daily_sku_sales")
    .select("date, manage_number, sku_id, units_sold");

  if (params.startDate) skuQuery = skuQuery.gte("date", params.startDate);
  if (params.endDate) skuQuery = skuQuery.lte("date", params.endDate);

  const { data: skuSales } = await skuQuery;

  const result: Record<string, { cost: number; shipping: number }> = {};
  for (const ss of skuSales || []) {
    const cost = costMap.get(`${ss.manage_number}::${ss.sku_id || ""}`);
    if (!cost) continue;
    if (!result[ss.date]) result[ss.date] = { cost: 0, shipping: 0 };
    result[ss.date].cost += cost.cost_price * ss.units_sold;
    result[ss.date].shipping += cost.shipping_fee * ss.units_sold;
  }
  return result;
}

export async function getRakutenProductSalesSummary(params: {
  startDate?: string;
  endDate?: string;
}) {
  // 売上データ取得
  let query = supabase
    .from("rakuten_daily_sales")
    .select("product_id, date, access_count, orders, sales_amount, units_sold, rakuten_product:rakuten_products(*)");

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) { console.warn("getRakutenProductSalesSummary error:", error); return []; }

  // 施策カレンダーからセールイベントを取得
  let eventQuery = supabase
    .from("product_events")
    .select("date, product_group, memo, product_id")
    .eq("event_type", "sale");

  if (params.startDate) eventQuery = eventQuery.gte("date", params.startDate);
  if (params.endDate) eventQuery = eventQuery.lte("date", params.endDate);

  const { data: saleEvents } = await eventQuery;

  const discountByProduct = new Map<string, number>();
  const discountByGroup = new Map<string, number>();
  for (const ev of saleEvents || []) {
    const rate = parseDiscountRate(ev.memo || "");
    if (rate > 0) {
      if (ev.product_id) {
        discountByProduct.set(`${ev.date}::${ev.product_id}`, rate);
      } else {
        discountByGroup.set(`${ev.date}::${ev.product_group}`, rate);
      }
    }
  }

  // 広告データ取得
  let adQuery = supabase
    .from("rakuten_daily_advertising")
    .select("product_id, ad_spend, ad_sales");

  if (params.startDate) adQuery = adQuery.gte("date", params.startDate);
  if (params.endDate) adQuery = adQuery.lte("date", params.endDate);

  const { data: adData } = await adQuery;

  const adByProduct: Record<string, { ad_spend: number; ad_sales: number }> = {};
  for (const row of adData || []) {
    if (!adByProduct[row.product_id]) {
      adByProduct[row.product_id] = { ad_spend: 0, ad_sales: 0 };
    }
    adByProduct[row.product_id].ad_spend += row.ad_spend;
    adByProduct[row.product_id].ad_sales += row.ad_sales;
  }

  // 商品別に集約
  const grouped = (data || []).reduce((acc: Record<string, any>, row: any) => {
    const pid = row.product_id;
    if (row.rakuten_product?.is_archived) return acc;

    if (!acc[pid]) {
      acc[pid] = {
        product: row.rakuten_product,
        total_sales: 0,
        total_orders: 0,
        total_access: 0,
        total_units: 0,
        sale_discount: 0,
      };
    }

    const salesAmount = row.sales_amount;

    // 施策カレンダーの割引は参考値のみ（利益計算には使わない）
    if (row.date) {
      const productSkuId = row.rakuten_product?.product_id;
      const productGroup = row.rakuten_product?.product_group;
      let discountRate = productSkuId
        ? discountByProduct.get(`${row.date}::${productSkuId}`)
        : undefined;
      if (!discountRate && productGroup) {
        discountRate = discountByGroup.get(`${row.date}::${productGroup}`);
      }
      if (discountRate && discountRate > 0) {
        acc[pid].sale_discount += Math.round(salesAmount * (discountRate / 100));
      }
    }

    acc[pid].total_sales += salesAmount;
    acc[pid].total_orders += row.orders;
    acc[pid].total_access += row.access_count;
    acc[pid].total_units += row.units_sold;
    return acc;
  }, {});

  // SKU別コストを取得（利益計算用）
  const productUuids = Object.keys(grouped);
  const skuCostsByUuid = await getSkuCostsByProduct(
    productUuids, params.startDate, params.endDate
  );

  return Object.entries(grouped).map(([pid, item]: [string, any]) => {
    const product = item.product;
    const feeRate = product?.fee_rate || 10;
    const ad = adByProduct[pid] || { ad_spend: 0, ad_sales: 0 };

    // SKU別コストがあればそちらを使用、なければ商品マスタのデフォルト値
    const skuCosts = skuCostsByUuid.get(pid);
    let totalCost: number;
    let totalShipping: number;

    if (skuCosts && (skuCosts.total_cost > 0 || skuCosts.total_shipping > 0)) {
      totalCost = skuCosts.total_cost;
      totalShipping = skuCosts.total_shipping;
    } else {
      const costPrice = product?.cost_price || 0;
      const shippingFee = product?.shipping_fee || 0;
      totalCost = costPrice * item.total_units;
      totalShipping = shippingFee * item.total_units;
    }

    const totalFee = Math.round(item.total_sales * (feeRate / 100));
    const totalAdSpend = ad.ad_spend;

    const grossProfit = item.total_sales - totalCost - totalShipping - totalFee;
    const netProfit = grossProfit - totalAdSpend;
    const profitRate = item.total_sales > 0 ? (netProfit / item.total_sales) * 100 : 0;
    const unitProfit = item.total_units > 0 ? Math.round(netProfit / item.total_units) : 0;

    return {
      ...item,
      total_cost: totalCost,
      total_shipping: totalShipping,
      total_fee: totalFee,
      total_ad_spend: totalAdSpend,
      total_ad_sales: ad.ad_sales,
      gross_profit: grossProfit,
      net_profit: netProfit,
      profit_rate: profitRate,
      unit_profit: unitProfit,
    };
  }).filter((item: any) => !item.product?.is_archived);
}

/**
 * RMS売上CSVをインポートして rakuten_daily_sales を更新する。
 */
export async function importRakutenSalesCSV(
  csvData: Array<{
    productNumber: string;
    salesAmount: number;
    orders: number;
    unitsSold: number;
    date: string;
  }>
): Promise<{ success: boolean; upserted: number; errors: string[] }> {
  const errors: string[] = [];
  let upserted = 0;

  for (const row of csvData) {
    const { data: product } = await supabase
      .from("rakuten_products")
      .select("id")
      .eq("product_id", row.productNumber)
      .maybeSingle();

    if (!product) {
      errors.push(`商品 ${row.productNumber} がマスタに見つかりません`);
      continue;
    }

    const { error } = await supabase.rpc("upsert_rakuten_sales", {
      p_product_id: product.id,
      p_date: row.date,
      p_sales_amount: row.salesAmount,
      p_orders: row.orders,
      p_units_sold: row.unitsSold,
      p_source: "csv",
    });

    if (error) {
      errors.push(`${row.productNumber} (${row.date}): ${error.message}`);
    } else {
      upserted++;
    }
  }

  return { success: errors.length === 0, upserted, errors };
}

/**
 * 日別の利益内訳を商品別サマリーと同一ロジックで集計して返す。
 * getRakutenProductSalesSummary と同じ計算経路なので日別合計 = 商品別合計の総和が保証される。
 *
 * 返値: date → { cost, fee, shipping, profit }
 */
export async function getRakutenDailyProfitBreakdown(params: {
  startDate?: string;
  endDate?: string;
}): Promise<Record<string, { cost: number; fee: number; shipping: number; profit: number }>> {
  // 1. 売上データ（商品マスタ込み）
  let salesQuery = supabase
    .from("rakuten_daily_sales")
    .select("product_id, date, sales_amount, units_sold, rakuten_product:rakuten_products(id, product_id, cost_price, shipping_fee, fee_rate, is_archived, parent_product_id)");

  if (params.startDate) salesQuery = salesQuery.gte("date", params.startDate);
  if (params.endDate) salesQuery = salesQuery.lte("date", params.endDate);

  const { data: salesData } = await salesQuery;

  // 2. SKU別コスト全件
  const { data: skuCosts } = await supabase
    .from("rakuten_sku_costs")
    .select("manage_number, sku_id, cost_price, shipping_fee");

  const costMap = new Map<string, { cost_price: number; shipping_fee: number }>();
  for (const sc of skuCosts || []) {
    costMap.set(`${sc.manage_number}::${sc.sku_id}`, { cost_price: sc.cost_price, shipping_fee: sc.shipping_fee });
  }

  // 3. 日別×SKU別販売数
  let skuQuery = supabase
    .from("rakuten_daily_sku_sales")
    .select("date, manage_number, sku_id, units_sold");

  if (params.startDate) skuQuery = skuQuery.gte("date", params.startDate);
  if (params.endDate) skuQuery = skuQuery.lte("date", params.endDate);

  const { data: skuSales } = await skuQuery;

  // SKU別コスト集計: date → { cost, shipping }
  const skuByDate: Record<string, { cost: number; shipping: number }> = {};
  for (const ss of skuSales || []) {
    const cost = costMap.get(`${ss.manage_number}::${ss.sku_id || ""}`);
    if (!cost) continue;
    if (!skuByDate[ss.date]) skuByDate[ss.date] = { cost: 0, shipping: 0 };
    skuByDate[ss.date].cost += cost.cost_price * ss.units_sold;
    skuByDate[ss.date].shipping += cost.shipping_fee * ss.units_sold;
  }

  // 商品マスタフォールバック用: product UUID → コスト情報
  const productCostMap = new Map<string, { cost_price: number; shipping_fee: number; fee_rate: number }>();
  for (const row of salesData || []) {
    const p = row.rakuten_product as any;
    if (!p || p.is_archived) continue;
    if (!productCostMap.has(row.product_id)) {
      productCostMap.set(row.product_id, {
        cost_price: p.cost_price || 0,
        shipping_fee: p.shipping_fee || 0,
        fee_rate: p.fee_rate || 10,
      });
    }
  }

  // 4. 日別に集計（fee は商品マスタベース、cost/shipping は SKU優先→商品マスタフォールバック）
  const byDate: Record<string, { cost: number; fee: number; shipping: number; salesAmount: number }> = {};

  for (const row of salesData || []) {
    const p = row.rakuten_product as any;
    if (!p || p.is_archived) continue;
    const date = row.date;
    if (!byDate[date]) byDate[date] = { cost: 0, fee: 0, shipping: 0, salesAmount: 0 };
    byDate[date].salesAmount += row.sales_amount || 0;
    const feeRate = (p.fee_rate || 10);
    byDate[date].fee += Math.round((row.sales_amount || 0) * (feeRate / 100));
    // cost/shipping は SKU集計で上書きするので一旦商品マスタで積算
    byDate[date].cost += (p.cost_price || 0) * (row.units_sold || 0);
    byDate[date].shipping += (p.shipping_fee || 0) * (row.units_sold || 0);
  }

  // SKU集計があれば cost/shipping を上書き（商品マスタよりも正確）
  for (const [date, sku] of Object.entries(skuByDate)) {
    if (!byDate[date]) continue;
    if (sku.cost > 0 || sku.shipping > 0) {
      // SKU集計は「SKUマッチした商品のみ」のため、商品マスタ合計との差分（未マッチ分）を加算
      // 日別SKU合計が商品マスタ合計を超える場合はSKUを信頼、下回る場合は商品マスタ側の未マッチ分を保持
      byDate[date].cost = Math.max(sku.cost, byDate[date].cost);
      byDate[date].shipping = Math.max(sku.shipping, byDate[date].shipping);
    }
  }

  // 広告費取得
  let adQuery = supabase.from("rakuten_daily_advertising").select("date, ad_spend");
  if (params.startDate) adQuery = adQuery.gte("date", params.startDate);
  if (params.endDate) adQuery = adQuery.lte("date", params.endDate);
  const { data: adData } = await adQuery;

  const adByDate: Record<string, number> = {};
  for (const row of adData || []) {
    adByDate[row.date] = (adByDate[row.date] || 0) + row.ad_spend;
  }

  // 最終集計
  const result: Record<string, { cost: number; fee: number; shipping: number; profit: number }> = {};
  for (const [date, d] of Object.entries(byDate)) {
    const adSpend = adByDate[date] || 0;
    result[date] = {
      cost: d.cost,
      fee: d.fee,
      shipping: d.shipping,
      profit: d.salesAmount - d.cost - d.fee - d.shipping - adSpend,
    };
  }
  return result;
}

export async function getRakutenProducts(includeArchived = false) {
  let query = supabase
    .from("rakuten_products")
    .select("*")
    .order("name");

  if (!includeArchived) query = query.eq("is_archived", false);

  const { data, error } = await query;
  if (error) { console.warn("getRakutenProducts error:", error); return []; }
  return data || [];
}
