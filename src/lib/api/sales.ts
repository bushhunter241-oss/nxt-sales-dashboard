import { supabase } from "@/lib/supabase";
import { DailySales } from "@/types/database";

export async function getDailySales(params: {
  startDate?: string;
  endDate?: string;
  productId?: string;
}) {
  let query = supabase
    .from("daily_sales")
    .select("*, product:products(*)")
    .order("date", { ascending: false });

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);
  if (params.productId) query = query.eq("product_id", params.productId);

  const { data, error } = await query;
  if (error) { console.warn("getDailySales error:", error); return []; }
  return data || [];
}

export async function getAggregatedDailySales(params: {
  startDate?: string;
  endDate?: string;
}) {
  let query = supabase
    .from("daily_sales")
    .select("date, sessions, orders, sales_amount, units_sold")
    .order("date", { ascending: true });

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) { console.warn("getAggregatedDailySales error:", error); return []; }

  // Aggregate by date
  const grouped = (data || []).reduce((acc: Record<string, any>, row) => {
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
  // 1. Fetch sales data with product info
  let query = supabase
    .from("daily_sales")
    .select("product_id, sessions, orders, sales_amount, units_sold, product:products(*)");

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) { console.warn("getProductSalesSummary error:", error); return []; }

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

  // 3. Group sales by product and calculate profit
  const grouped = (data || []).reduce((acc: Record<string, any>, row: any) => {
    const pid = row.product_id;
    if (!acc[pid]) {
      acc[pid] = {
        product: row.product,
        total_sales: 0,
        total_orders: 0,
        total_sessions: 0,
        total_units: 0,
      };
    }
    acc[pid].total_sales += row.sales_amount;
    acc[pid].total_orders += row.orders;
    acc[pid].total_sessions += row.sessions;
    acc[pid].total_units += row.units_sold;
    return acc;
  }, {});

  // 4. Calculate profit for each product
  return Object.values(grouped).map((item: any) => {
    const product = item.product;
    const costPrice = product?.cost_price || 0;
    const fbaFeeRate = product?.fba_fee_rate || 15;
    const sellingPrice = product?.selling_price || 0;
    const ad = adByProduct[product?.id] || { ad_spend: 0, ad_sales: 0 };

    // Cost calculations
    const totalCost = costPrice * item.total_units;
    const totalFbaFee = Math.round(item.total_sales * (fbaFeeRate / 100));
    const totalAdSpend = ad.ad_spend;

    // Gross profit = Sales - Cost - FBA Fee
    const grossProfit = item.total_sales - totalCost - totalFbaFee;
    // Net profit = Gross Profit - Ad Spend
    const netProfit = grossProfit - totalAdSpend;
    // Profit rate
    const profitRate = item.total_sales > 0 ? (netProfit / item.total_sales) * 100 : 0;
    // Unit profit
    const unitProfit = item.total_units > 0 ? Math.round(netProfit / item.total_units) : 0;

    return {
      ...item,
      total_cost: totalCost,
      total_fba_fee: totalFbaFee,
      total_ad_spend: totalAdSpend,
      total_ad_sales: ad.ad_sales,
      gross_profit: grossProfit,
      net_profit: netProfit,
      profit_rate: profitRate,
      unit_profit: unitProfit,
    };
  });
}
