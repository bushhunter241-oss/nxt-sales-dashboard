import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function db() { return createClient(supabaseUrl, supabaseAnonKey); }

const KEYWORDS: Record<string, string[]> = {
  sales: ["売上", "注文", "利益", "売れ"],
  ads: ["広告", "ACOS", "ROAS", "CPC", "CVR", "キャンペーン"],
  inventory: ["在庫", "発注", "欠品"],
  goals: ["目標", "達成", "着地", "予想"],
  rakuten: ["楽天", "RMS", "RPP"],
  amazon: ["Amazon", "アマゾン", "SP-API"],
};

function detectTopics(message: string): string[] {
  const topics: string[] = [];
  for (const [topic, kws] of Object.entries(KEYWORDS)) {
    if (kws.some(kw => message.toLowerCase().includes(kw.toLowerCase()))) {
      topics.push(topic);
    }
  }
  return topics.length > 0 ? topics : ["sales", "ads"];
}

export async function getChatContext(message: string) {
  const topics = detectTopics(message);
  const s = db();
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthStart = `${ym}-01`;
  const today = now.toISOString().split("T")[0];
  const d7 = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

  const context: Record<string, any> = {};

  if (topics.includes("sales") || topics.includes("amazon") || topics.includes("rakuten")) {
    const { data: sales } = await s.from("daily_sales").select("sales_amount, orders, product:products(product_group, name, is_archived, is_parent)").gte("date", thisMonthStart).lte("date", today);
    const { data: rktSales } = await s.from("rakuten_daily_sales").select("sales_amount, orders, rakuten_product:rakuten_products(product_group, name, is_archived)").gte("date", thisMonthStart).lte("date", today);

    const salesByGroupAndChannel: Array<{ group: string; channel: string; sales: number; orders: number }> = [];
    for (const r of sales || []) {
      const p = (r as any).product;
      if (p?.is_archived || p?.is_parent) continue;
      const g = p?.product_group || "その他";
      const existing = salesByGroupAndChannel.find(x => x.group === g && x.channel === "Amazon");
      if (existing) { existing.sales += r.sales_amount; existing.orders += r.orders; }
      else salesByGroupAndChannel.push({ group: g, channel: "Amazon", sales: r.sales_amount, orders: r.orders });
    }
    for (const r of rktSales || []) {
      const rp = (r as any).rakuten_product;
      if (rp?.is_archived) continue;
      const g = rp?.product_group || "その他";
      const existing = salesByGroupAndChannel.find(x => x.group === g && x.channel === "楽天");
      if (existing) { existing.sales += r.sales_amount; existing.orders += r.orders; }
      else salesByGroupAndChannel.push({ group: g, channel: "楽天", sales: r.sales_amount, orders: r.orders });
    }
    context.salesByGroupAndChannel = salesByGroupAndChannel;
  }

  if (topics.includes("ads")) {
    const { data: ads } = await s.from("daily_advertising").select("ad_spend, ad_sales, campaign_name, product:products(product_group, is_archived, is_parent)").gte("date", d7);
    const byCampaign: Record<string, { spend: number; sales: number }> = {};
    for (const r of ads || []) {
      const p = (r as any).product;
      if (p?.is_archived || p?.is_parent) continue;
      const key = `${p?.product_group || "?"} / ${r.campaign_name || "?"}`;
      if (!byCampaign[key]) byCampaign[key] = { spend: 0, sales: 0 };
      byCampaign[key].spend += r.ad_spend;
      byCampaign[key].sales += r.ad_sales;
    }
    context.adsByCampaign = Object.entries(byCampaign).map(([k, v]) => ({
      campaign: k, spend: v.spend, sales: v.sales, acos: v.sales > 0 ? Math.round((v.spend / v.sales) * 100) : 0,
    })).sort((a, b) => b.spend - a.spend).slice(0, 20);
  }

  if (topics.includes("inventory")) {
    const { data: inv } = await s.from("inventory").select("current_stock, reorder_point, product:products(name, product_group, is_archived)");
    context.inventory = (inv || []).filter((i: any) => !i.product?.is_archived).map((i: any) => ({ name: i.product?.name, stock: i.current_stock, reorderPoint: i.reorder_point }));
  }

  if (topics.includes("goals")) {
    const { data: goals } = await s.from("monthly_goals").select("*").eq("year_month", ym).is("product_id", null);
    context.goals = (goals || []).map((g: any) => ({ group: g.product_group, targetSales: g.target_sales, targetProfit: g.target_profit }));
  }

  return context;
}
