import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function db() { return createClient(supabaseUrl, supabaseAnonKey); }

interface GroupChannelData { group: string; channel: string; sales: number; orders: number }

export async function getInsightData() {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthStart = `${ym}-01`;
  const today = now.toISOString().split("T")[0];
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lmStart = lastMonth.toISOString().split("T")[0];
  const lmEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split("T")[0];
  const d7 = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
  const d14 = new Date(Date.now() - 14 * 86400000).toISOString().split("T")[0];

  const s = db();

  const [thisMonthSales, lastMonthSales, thisMonthRktSales, lastMonthRktSales, recent7dAds, prev7dAds, recent7dRktAds, goals, inventory, thisMonthShopify, lastMonthShopify, campaignAds7d] = await Promise.all([
    s.from("daily_sales").select("sales_amount, orders, product:products(product_group, name, is_archived, is_parent)").gte("date", thisMonthStart).lte("date", today),
    s.from("daily_sales").select("sales_amount, orders, product:products(product_group, name, is_archived, is_parent)").gte("date", lmStart).lte("date", lmEnd),
    s.from("rakuten_daily_sales").select("sales_amount, orders, rakuten_product:rakuten_products(product_group, name, is_archived)").gte("date", thisMonthStart).lte("date", today),
    s.from("rakuten_daily_sales").select("sales_amount, orders, rakuten_product:rakuten_products(product_group, name, is_archived)").gte("date", lmStart).lte("date", lmEnd),
    s.from("daily_advertising").select("ad_spend, ad_sales, product:products(product_group, is_archived, is_parent)").gte("date", d7),
    s.from("daily_advertising").select("ad_spend, ad_sales, product:products(product_group, is_archived, is_parent)").gte("date", d14).lt("date", d7),
    s.from("rakuten_daily_advertising").select("ad_spend, ad_sales, rakuten_product:rakuten_products(product_group, is_archived)").gte("date", d7),
    s.from("monthly_goals").select("*").eq("year_month", ym).is("product_id", null),
    s.from("inventory").select("current_stock, reorder_point, product:products(name, product_group, is_archived)"),
    s.from("shopify_daily_summary").select("date, net_sales, total_orders").gte("date", thisMonthStart).lte("date", today),
    s.from("shopify_daily_summary").select("date, net_sales, total_orders").gte("date", lmStart).lte("date", lmEnd),
    s.from("daily_campaign_advertising").select("ad_spend, ad_sales, product_group").gte("date", d7),
  ]);

  const groupByChannel = (rows: any[], channel: string, productKey = "product"): GroupChannelData[] => {
    const groups: Record<string, GroupChannelData> = {};
    for (const r of rows || []) {
      const p = r[productKey];
      if (p?.is_archived || p?.is_parent) continue;
      const g = p?.product_group || "その他";
      if (!groups[g]) groups[g] = { group: g, channel, sales: 0, orders: 0 };
      groups[g].sales += r.sales_amount || 0;
      groups[g].orders += r.orders || 0;
    }
    return Object.values(groups);
  };

  const adByChannel = (rows: any[], channel: string, productKey = "product") => {
    const groups: Record<string, { group: string; channel: string; spend: number; sales: number }> = {};
    for (const r of rows || []) {
      const p = r[productKey];
      if (p?.is_archived || p?.is_parent) continue;
      const g = p?.product_group || "その他";
      if (!groups[g]) groups[g] = { group: g, channel, spend: 0, sales: 0 };
      groups[g].spend += r.ad_spend || 0;
      groups[g].sales += r.ad_sales || 0;
    }
    return Object.values(groups);
  };

  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const lowStock = (inventory.data || [])
    .filter((i: any) => i.current_stock <= i.reorder_point && !i.product?.is_archived)
    .map((i: any) => ({ name: i.product?.name, stock: i.current_stock, reorderPoint: i.reorder_point }));

  return {
    thisMonth: {
      salesByGroupAndChannel: [
        ...groupByChannel(thisMonthSales.data || [], "Amazon"),
        ...groupByChannel(thisMonthRktSales.data || [], "楽天", "rakuten_product"),
      ],
    },
    lastMonth: {
      salesByGroupAndChannel: [
        ...groupByChannel(lastMonthSales.data || [], "Amazon"),
        ...groupByChannel(lastMonthRktSales.data || [], "楽天", "rakuten_product"),
      ],
    },
    recent7dAds: [
      ...adByChannel(recent7dAds.data || [], "Amazon"),
      ...adByChannel(recent7dRktAds.data || [], "楽天", "rakuten_product"),
    ],
    // キャンペーン単位の正確な広告費（ASIN二重計上なし）
    campaignAds7d: (campaignAds7d.data || []).reduce((acc: Record<string, { spend: number; sales: number }>, r: any) => {
      const g = r.product_group || "未分類";
      if (!acc[g]) acc[g] = { spend: 0, sales: 0 };
      acc[g].spend += r.ad_spend || 0;
      acc[g].sales += r.ad_sales || 0;
      return acc;
    }, {} as Record<string, { spend: number; sales: number }>),
    prev7dAds: adByChannel(prev7dAds.data || [], "Amazon"),
    shopify: {
      thisMonth: { sales: (thisMonthShopify.data || []).reduce((s: number, d: any) => s + (d.net_sales || 0), 0), orders: (thisMonthShopify.data || []).reduce((s: number, d: any) => s + (d.total_orders || 0), 0) },
      lastMonth: { sales: (lastMonthShopify.data || []).reduce((s: number, d: any) => s + (d.net_sales || 0), 0), orders: (lastMonthShopify.data || []).reduce((s: number, d: any) => s + (d.total_orders || 0), 0) },
    },
    goals: (goals.data || []).map((g: any) => ({ group: g.product_group, targetSales: g.target_sales, targetProfit: g.target_profit })),
    inventoryAlerts: lowStock,
    dayOfMonth,
    daysInMonth,
  };
}
