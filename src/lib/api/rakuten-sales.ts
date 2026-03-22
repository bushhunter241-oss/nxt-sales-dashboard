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
  return data || [];
}

export async function getAggregatedRakutenDailySales(params: {
  startDate?: string;
  endDate?: string;
}) {
  let query = supabase
    .from("rakuten_daily_sales")
    .select("date, access_count, orders, sales_amount, units_sold")
    .order("date", { ascending: true });

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) { console.warn("getAggregatedRakutenDailySales error:", error); return []; }

  const grouped = (data || []).reduce((acc: Record<string, any>, row) => {
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

/**
 * Safely update access_count and cvr without overwriting existing sales data.
 * If no row exists for the product+date, creates one with the access data.
 */
export async function updateRakutenAccessData(params: {
  productId: string;
  date: string;
  accessCount: number;
  cvr: number;
}) {
  // Check if a row already exists
  const { data: existing } = await supabase
    .from("rakuten_daily_sales")
    .select("id, orders, sales_amount, units_sold, cancellations, source")
    .eq("product_id", params.productId)
    .eq("date", params.date)
    .maybeSingle();

  if (existing) {
    // Update only access_count and cvr, preserve everything else
    const { error } = await supabase
      .from("rakuten_daily_sales")
      .update({ access_count: params.accessCount, cvr: params.cvr })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    // No existing row — create new with access data only
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

export async function getRakutenProductSalesSummary(params: {
  startDate?: string;
  endDate?: string;
}) {
  let query = supabase
    .from("rakuten_daily_sales")
    .select("product_id, access_count, orders, sales_amount, units_sold, rakuten_product:rakuten_products(*)");

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) { console.warn("getRakutenProductSalesSummary error:", error); return []; }

  // Fetch Rakuten advertising data
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

  const grouped = (data || []).reduce((acc: Record<string, any>, row: any) => {
    const pid = row.product_id;
    if (!acc[pid]) {
      acc[pid] = {
        product: row.rakuten_product,
        total_sales: 0,
        total_orders: 0,
        total_access: 0,
        total_units: 0,
      };
    }
    acc[pid].total_sales += row.sales_amount;
    acc[pid].total_orders += row.orders;
    acc[pid].total_access += row.access_count;
    acc[pid].total_units += row.units_sold;
    return acc;
  }, {});

  return Object.values(grouped).map((item: any) => {
    const product = item.product;
    const costPrice = product?.cost_price || 0;
    const feeRate = product?.fee_rate || 10;
    const ad = adByProduct[product?.id] || { ad_spend: 0, ad_sales: 0 };

    const totalCost = costPrice * item.total_units;
    const totalFee = Math.round(item.total_sales * (feeRate / 100));
    const totalAdSpend = ad.ad_spend;

    const grossProfit = item.total_sales - totalCost - totalFee;
    const netProfit = grossProfit - totalAdSpend;
    const profitRate = item.total_sales > 0 ? (netProfit / item.total_sales) * 100 : 0;
    const unitProfit = item.total_units > 0 ? Math.round(netProfit / item.total_units) : 0;

    return {
      ...item,
      total_cost: totalCost,
      total_fee: totalFee,
      total_ad_spend: totalAdSpend,
      total_ad_sales: ad.ad_sales,
      gross_profit: grossProfit,
      net_profit: netProfit,
      profit_rate: profitRate,
      unit_profit: unitProfit,
    };
  });
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
