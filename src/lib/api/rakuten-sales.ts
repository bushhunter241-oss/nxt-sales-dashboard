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
    .select("date, access_count, orders, sales_amount, units_sold, rakuten_product:rakuten_products(is_archived)")
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

/** 子商品で原価未設定の場合、親商品の原価にフォールバック */
function getEffectiveCostPrice(product: any, parentProductMap: Map<string, any>): number {
  if (product?.cost_price > 0) return product.cost_price;
  if (product?.parent_product_id) {
    const parent = parentProductMap.get(product.parent_product_id);
    if (parent && parent.cost_price > 0) return parent.cost_price;
  }
  return 0;
}

/** 子商品で送料未設定の場合、親商品の送料にフォールバック */
function getEffectiveShippingFee(product: any, parentProductMap: Map<string, any>): number {
  if (product?.shipping_fee > 0) return product.shipping_fee;
  if (product?.parent_product_id) {
    const parent = parentProductMap.get(product.parent_product_id);
    if (parent && parent.shipping_fee > 0) return parent.shipping_fee;
  }
  return 0;
}

/**
 * 施策カレンダーのセールイベントmemoから割引率(%)を抽出
 * 例: "5%OFFクーポン" → 5, "10%引き" → 10, "20%ポイントバック" → 20
 */
function parseDiscountRate(memo: string): number {
  const match = memo.match(/(\d+)%/);
  return match ? parseInt(match[1], 10) : 0;
}

export async function getRakutenProductSalesSummary(params: {
  startDate?: string;
  endDate?: string;
}) {
  // 日付つきで売上を取得（セール割引の日別適用に必要）
  let query = supabase
    .from("rakuten_daily_sales")
    .select("product_id, date, access_count, orders, sales_amount, units_sold, rakuten_product:rakuten_products(*)");

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) { console.warn("getRakutenProductSalesSummary error:", error); return []; }

  // 親商品マップを作成（原価・送料フォールバック用）
  const { data: allProducts } = await supabase
    .from("rakuten_products")
    .select("*")
    .eq("is_archived", false);

  const parentProductMap = new Map<string, any>(
    (allProducts || [])
      .filter(p => !p.parent_product_id)
      .map(p => [p.product_id, p])
  );

  // 施策カレンダーからセールイベントを取得（割引適用用）
  let eventQuery = supabase
    .from("product_events")
    .select("date, product_group, memo, product_id")
    .eq("event_type", "sale");

  if (params.startDate) eventQuery = eventQuery.gte("date", params.startDate);
  if (params.endDate) eventQuery = eventQuery.lte("date", params.endDate);

  const { data: saleEvents } = await eventQuery;

  // 割引率のマップを構築
  // 商品ID指定あり: date::product_id → 割引率（優先）
  // グループ指定のみ: date::group::product_group → 割引率（フォールバック）
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
        sale_discount: 0,
      };
    }

    const salesAmount = row.sales_amount;

    // 施策カレンダーの割引は利益計算に適用しない（表示用メモのみ）
    // 理由: API/CSVの sales_amount は既にクーポン控除後の実売値のため、
    //        施策カレンダーの割引率を重ねて適用すると二重控除になる
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
        // sale_discount は参考値として記録のみ（利益計算には使わない）
        acc[pid].sale_discount += Math.round(salesAmount * (discountRate / 100));
      }
    }

    acc[pid].total_sales += salesAmount;
    acc[pid].total_orders += row.orders;
    acc[pid].total_access += row.access_count;
    acc[pid].total_units += row.units_sold;
    return acc;
  }, {});

  return Object.values(grouped).map((item: any) => {
    const product = item.product;
    const costPrice = getEffectiveCostPrice(product, parentProductMap);
    const shippingFee = getEffectiveShippingFee(product, parentProductMap);
    const feeRate = product?.fee_rate || 10;
    const ad = adByProduct[product?.id] || { ad_spend: 0, ad_sales: 0 };

    const totalCost = costPrice * item.total_units;
    const totalShipping = shippingFee * item.total_units;
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
 * RPC関数 upsert_rakuten_sales を使い、既存の access_count/cvr を保持する。
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
    // 商品管理番号 → rakuten_products で検索（product_id or sku）
    const { data: product } = await supabase
      .from("rakuten_products")
      .select("id")
      .or(`product_id.eq.${row.productNumber},sku.eq.${row.productNumber}`)
      .limit(1)
      .maybeSingle();

    if (!product) {
      errors.push(`商品 ${row.productNumber} がマスタに見つかりません`);
      continue;
    }

    // RPC関数で売上のみ更新（access_count/cvrは保持）
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
