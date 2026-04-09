import { createClient } from "@supabase/supabase-js";
import { fetchInsights } from "@/lib/meta/client";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function syncMetaAds(dateFrom: string, dateTo: string) {
  const insights = await fetchInsights(dateFrom, dateTo);

  if (insights.length === 0) {
    return { success: true, message: `${dateFrom}〜${dateTo}: データなし`, count: 0 };
  }

  const db = createClient(supabaseUrl, supabaseAnonKey);

  const { error: deleteError } = await db
    .from("meta_ad_daily")
    .delete()
    .gte("date", dateFrom)
    .lte("date", dateTo);

  if (deleteError) {
    console.warn("meta_ad_daily delete error:", deleteError.message);
  }

  let inserted = 0;
  const errors: string[] = [];

  for (const row of insights) {
    const purchases = parseInt(row.actions?.find(a => a.action_type === "purchase")?.value || "0") || 0;
    const addToCart = parseInt(row.actions?.find(a => a.action_type === "add_to_cart")?.value || "0") || 0;
    const purchaseValue = parseFloat(row.actions?.find(a => a.action_type === "omni_purchase")?.value || row.actions?.find(a => a.action_type === "purchase")?.value || "0") || 0;

    const spend = Math.round(parseFloat(row.spend) || 0);

    const record = {
      date: row.date_start,
      campaign_name: row.campaign_name || null,
      ad_set_name: null,
      ad_name: null,
      impressions: parseInt(row.impressions) || 0,
      clicks: parseInt(row.clicks) || 0,
      spend,
      purchases,
      add_to_cart: addToCart,
      purchase_value: Math.round(purchaseValue * (spend || 1)),
      cpm: parseFloat(row.cpm) || 0,
      cpc: parseFloat(row.cpc) || 0,
      ctr: parseFloat(row.ctr) || 0,
      roas: purchaseValue > 0 && spend > 0 ? purchaseValue : 0,
    };

    const { error } = await db.from("meta_ad_daily").insert(record);

    if (error) {
      errors.push(`${row.date_start} ${row.campaign_name}: ${error.message}`);
    } else {
      inserted++;
    }
  }

  return {
    success: errors.length === 0,
    message: `Meta広告 ${insights.length}件取得 → ${inserted}件保存${errors.length > 0 ? ` (${errors.length}件エラー)` : ""}`,
    count: inserted,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
  };
}
