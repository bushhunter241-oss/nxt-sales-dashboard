import { supabase } from "@/lib/supabase";
import { DailySales } from "@/types/database";
import { calcRowCosts, calcNetProfit } from "@/lib/api/profit";

export async function getDailySales(params: {
  startDate?: string;
  endDate?: string;
  productId?: string;
}) {
  // Supabaseの1000件制限に対応するためページネーション
  const allData: any[] = [];
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from("daily_sales")
      .select("*, product:products(*)")
      .order("date", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (params.startDate) query = query.gte("date", params.startDate);
    if (params.endDate) query = query.lte("date", params.endDate);
    if (params.productId) query = query.eq("product_id", params.productId);

    const { data, error } = await query;
    if (error) { console.warn("getDailySales error:", error); break; }

    allData.push(...(data || []));
    hasMore = (data?.length || 0) === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  return allData.filter((r: any) => !r.product?.is_archived && !r.product?.is_parent);
}

export async function getAggregatedDailySales(params: {
  startDate?: string;
  endDate?: string;
}) {
  let query = supabase
    .from("daily_sales")
    .select("date, sessions, orders, sales_amount, units_sold, product:products(is_archived, is_parent)")
    .order("date", { ascending: true });

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) { console.warn("getAggregatedDailySales error:", error); return []; }

  // Aggregate by date (excluding archived/parent products)
  const grouped = (data || []).reduce((acc: Record<string, any>, row: any) => {
    if (row.product?.is_archived || row.product?.is_parent) return acc;
    if (!acc[row.date]) {
      acc[row.date] = { date: row.date, sessions: 0, orders: 0, sales_amount: 0, units_sold: 0 };
    }
    acc[row.date].sessions += row.sessions;
    acc[row.date].orders += row.orders;
    acc[row.date].sales_amount += row.sales_amount;
    acc[row.date].units_sold += row.units_sold;
    return acc;
  }, {});

  return Object.values(grouped);
}

export async function upsertDailySales(sales: Omit<DailySales, "id" | "created_at">) {
  const { data, error } = await supabase
    .from("daily_sales")
    .upsert(sales, { onConflict: "product_id,date" })
    .select()
    .single();
  if (error) throw error;
  return data as DailySales;
}

export async function getProductSalesSummary(params: {
  startDate?: string;
  endDate?: string;
}) {
  // 1. Fetch sales data with product info (ページネーション対応) — date も取得（ポイント施策突き合わせ用）
  const allSalesData: any[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    let query = supabase
      .from("daily_sales")
      .select("product_id, date, sessions, orders, sales_amount, units_sold, product:products(*)")
      .range(offset, offset + 999);
    if (params.startDate) query = query.gte("date", params.startDate);
    if (params.endDate) query = query.lte("date", params.endDate);
    const { data: page, error } = await query;
    if (error) { console.warn("getProductSalesSummary error:", error); break; }
    allSalesData.push(...(page || []));
    hasMore = (page?.length || 0) === 1000;
    offset += 1000;
  }
  const data = allSalesData;

  // 2. Fetch advertising data for the same period
  let adQuery = supabase
    .from("daily_advertising")
    .select("product_id, ad_spend, ad_sales");

  if (params.startDate) adQuery = adQuery.gte("date", params.startDate);
  if (params.endDate) adQuery = adQuery.lte("date", params.endDate);

  const { data: adData } = await adQuery;

  // Aggregate ad spend by product
  const adByProduct: Record<string, { ad_spend: number; ad_sales: number }> = {};
  for (const row of adData || []) {
    if (!adByProduct[row.product_id]) {
      adByProduct[row.product_id] = { ad_spend: 0, ad_sales: 0 };
    }
    adByProduct[row.product_id].ad_spend += row.ad_spend;
    adByProduct[row.product_id].ad_sales += row.ad_sales;
  }

  // 2b. Fetch expenses data for the same period
  let expQuery = supabase
    .from("expenses")
    .select("product_id, amount");

  if (params.startDate) expQuery = expQuery.gte("date", params.startDate);
  if (params.endDate) expQuery = expQuery.lte("date", params.endDate);

  const { data: expData } = await expQuery;

  // Aggregate expenses by product (product_id=null は全体経費として各商品には加算しない)
  const expByProduct: Record<string, number> = {};
  for (const row of expData || []) {
    if (!row.product_id) continue;
    expByProduct[row.product_id] = (expByProduct[row.product_id] || 0) + row.amount;
  }

  // 2c. Fetch point events (施策カレンダーのポイント施策) for the same period
  let pointEventQuery = supabase
    .from("product_events")
    .select("date, product_group, discount_rate")
    .eq("event_type", "point");

  if (params.startDate) pointEventQuery = pointEventQuery.gte("date", params.startDate);
  if (params.endDate) pointEventQuery = pointEventQuery.lte("date", params.endDate);

  const { data: pointEvents } = await pointEventQuery;

  // Build lookup: "date|product_group" → discount_rate (%)
  const pointEventMap: Record<string, number> = {};
  for (const ev of pointEvents || []) {
    if (!ev.discount_rate || !ev.product_group) continue;
    const key = `${ev.date}|${ev.product_group}`;
    // 同日・同グループに複数イベントがある場合は最大値を適用
    pointEventMap[key] = Math.max(pointEventMap[key] || 0, ev.discount_rate);
  }

  // 3. Group sales by product and calculate profit
  // ポイント施策がある日の売上を別途集計
  const grouped = (data || []).reduce((acc: Record<string, any>, row: any) => {
    const pid = row.product_id;
    if (!acc[pid]) {
      acc[pid] = {
        product: row.product,
        total_sales: 0,
        total_orders: 0,
        total_sessions: 0,
        total_units: 0,
        event_point_cost: 0,
      };
    }
    acc[pid].total_sales += row.sales_amount;
    acc[pid].total_orders += row.orders;
    acc[pid].total_sessions += row.sessions;
    acc[pid].total_units += row.units_sold;

    // 施策カレンダーのポイント施策をチェック
    const productGroup = row.product?.product_group;
    if (productGroup && row.date) {
      const eventKey = `${row.date}|${productGroup}`;
      const eventPointRate = pointEventMap[eventKey];
      if (eventPointRate) {
        acc[pid].event_point_cost += Math.round(row.sales_amount * (eventPointRate / 100));
      }
    }

    return acc;
  }, {});

  // 4. Calculate profit for each product using shared profit.ts
  const result = Object.values(grouped).map((item: any) => {
    const product = item.product;
    const ad = adByProduct[product?.id] || { ad_spend: 0, ad_sales: 0 };
    const totalExpenses = expByProduct[product?.id] || 0;

    // calcRowCosts を使うと月次集計でも同じ計算式が使われる。
    // getProductSalesSummary では per-product の累計値で計算するため、
    // 「全販売個数・全売上」に対して1回だけ calcRowCosts を呼ぶ。
    const { cost: totalCost, fba_fee: totalFbaFee, point_cost: basePointCost } = calcRowCosts(
      item.total_sales,
      item.total_units,
      product,
    );
    const totalPointCost = basePointCost + (item.event_point_cost || 0);
    const totalAdSpend = ad.ad_spend;

    const { gross_profit, net_profit, profit_rate } = calcNetProfit(
      item.total_sales,
      totalCost,
      totalFbaFee,
      totalPointCost,
      totalAdSpend,
      totalExpenses,
    );

    const totalReferralFee = Math.round(item.total_sales * ((product?.fba_fee_rate ?? 15) / 100));
    const totalShippingFee = (product?.fba_shipping_fee ?? 0) * item.total_units;
    const unitProfit = item.total_units > 0 ? Math.round(net_profit / item.total_units) : 0;

    return {
      ...item,
      total_cost: totalCost,
      total_referral_fee: totalReferralFee,
      total_shipping_fee: totalShippingFee,
      total_fba_fee: totalFbaFee,
      total_point_cost: totalPointCost,
      total_ad_spend: totalAdSpend,
      total_ad_sales: ad.ad_sales,
      total_expenses: totalExpenses,
      gross_profit,
      net_profit,
      profit_rate,
      unit_profit: unitProfit,
    };
  });

  return filterOutParentAsins(result);
}

/**
 * 子ASINが参照する親ASINを自動判定して除外するフィルタ。
 * archived / is_parent / 子ASINに参照されるASIN をすべて除外。
 */
export function filterOutParentAsins<T extends { product?: any }>(items: T[]): T[] {
  const childParentAsins = new Set<string>();
  for (const item of items) {
    if (item.product?.parent_asin) childParentAsins.add(item.product.parent_asin);
  }
  return items.filter((item) => {
    if (item.product?.is_archived) return false;
    if (item.product?.is_parent) return false;
    if (item.product?.asin && childParentAsins.has(item.product.asin)) return false;
    return true;
  });
}
