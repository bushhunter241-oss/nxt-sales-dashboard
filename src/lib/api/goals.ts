import { supabase } from "@/lib/supabase";
import { MonthlyGoal } from "@/types/database";

export async function getMonthlyGoals(yearMonth: string) {
  const { data, error } = await supabase
    .from("monthly_goals")
    .select("*, product:products(*)")
    .eq("year_month", yearMonth);
  if (error) { console.warn("getMonthlyGoals error:", error); return []; }
  // 旧フォーマット ("amazon::feela" / "rakuten::Moon") を product_group からパース。
  // マイグレーション018で channel に DEFAULT 'total' が付いているため、
  // row.channel === 'total' でも product_group に "::" が含まれていれば
  // 旧データとして扱い、prefix を本来の channel として復元する。
  const KNOWN_CHANNELS = new Set(["amazon", "rakuten", "shopify"]);
  return (data || []).map((row: any) => {
    let channel = row.channel || "total";
    let productGroup = row.product_group;
    if (typeof productGroup === "string" && productGroup.includes("::")) {
      const [prefix, ...rest] = productGroup.split("::");
      const restStr = rest.join("::");
      if (prefix && restStr && KNOWN_CHANNELS.has(prefix)) {
        channel = prefix;
        productGroup = restStr;
      }
    }
    return { ...row, channel, product_group: productGroup };
  });
}

export async function upsertMonthlyGoal(goal: Omit<MonthlyGoal, "id" | "created_at">) {
  const { data, error } = await supabase
    .from("monthly_goals")
    .upsert(goal, { onConflict: "product_id,year_month" })
    .select()
    .single();
  if (error) throw error;
  return data as MonthlyGoal;
}

/**
 * グループレベルの目標を upsert する
 * channel列がDBに存在しない場合も動作するようフォールバック処理付き
 */
export async function upsertGroupGoal(params: {
  product_group: string;
  year_month: string;
  target_sales: number;
  target_orders: number;
  target_profit: number;
  target_ad_budget?: number;
  channel?: string;
}) {
  const channel = params.channel || "total";
  // 0でも保存できるよう、明示的に渡されている値はすべて含める
  // （0クリアで以前の非ゼロ値が残るバグを防ぐ）
  const goalData: Record<string, any> = {
    target_sales: params.target_sales,
    target_orders: params.target_orders,
    target_profit: params.target_profit,
  };
  if (params.target_ad_budget !== undefined) {
    goalData.target_ad_budget = params.target_ad_budget;
  }

  // Step 1: 既存レコードを検索（channel列あり）
  const { data: existingWithChannel, error: searchErr } = await supabase
    .from("monthly_goals")
    .select("id")
    .eq("product_group", params.product_group)
    .eq("year_month", params.year_month)
    .eq("channel", channel)
    .is("product_id", null)
    .maybeSingle();

  // channel列がDBに存在しない場合、searchErrにエラーが入る
  const hasChannelColumn = !searchErr || !searchErr.message?.includes("column");

  if (hasChannelColumn && existingWithChannel) {
    // UPDATE（channel列あり、既存レコードあり）
    const { data, error } = await supabase
      .from("monthly_goals")
      .update(goalData)
      .eq("id", existingWithChannel.id)
      .select()
      .single();
    if (error) { console.error("Goal update error:", error); throw error; }
    return data as MonthlyGoal;
  }

  if (hasChannelColumn && !existingWithChannel) {
    // INSERT（channel列あり、新規）
    const { data, error } = await supabase
      .from("monthly_goals")
      .insert({
        product_id: null,
        product_group: params.product_group,
        year_month: params.year_month,
        channel,
        ...goalData,
      })
      .select()
      .single();
    if (error) { console.error("Goal insert error:", error); throw error; }
    return data as MonthlyGoal;
  }

  // フォールバック: channel列なし
  const { data: existingNoChannel } = await supabase
    .from("monthly_goals")
    .select("id")
    .eq("product_group", params.product_group)
    .eq("year_month", params.year_month)
    .is("product_id", null)
    .maybeSingle();

  if (existingNoChannel) {
    const { data, error } = await supabase
      .from("monthly_goals")
      .update(goalData)
      .eq("id", existingNoChannel.id)
      .select()
      .single();
    if (error) { console.error("Goal update (no channel) error:", error); throw error; }
    return data as MonthlyGoal;
  } else {
    const { data, error } = await supabase
      .from("monthly_goals")
      .insert({
        product_id: null,
        product_group: params.product_group,
        year_month: params.year_month,
        ...goalData,
      })
      .select()
      .single();
    if (error) { console.error("Goal insert (no channel) error:", error); throw error; }
    return data as MonthlyGoal;
  }
}

export async function upsertRakutenGroupGoal(params: {
  product_group: string;
  year_month: string;
  target_sales: number;
  target_orders: number;
  target_profit: number;
  target_ad_budget?: number;
}) {
  return upsertGroupGoal({ ...params, channel: "rakuten" });
}

export async function getRakutenMonthlyGoals(yearMonth: string) {
  const goals = await getMonthlyGoals(yearMonth);
  return (goals || []).filter((g: any) => g.channel === "rakuten");
}
