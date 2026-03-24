import { supabase } from "@/lib/supabase";
import { MonthlyGoal } from "@/types/database";

// monthly_goals テーブルの channel カラム（TEXT, DEFAULT 'total'）を使って
// amazon / rakuten / total を管理する。
// 後方互換: 旧来のプレフィックス形式（"amazon::groupName"）も読み取れるようにしておく。

const CHANNEL_PREFIXES: Record<string, string> = {
  amazon: "amazon::",
  rakuten: "rakuten::",
};

function parseGoalRow(row: any): any {
  // DB の channel カラムが有効な値（amazon/rakuten）なら優先使用
  if (row.channel && row.channel !== "total") {
    return row; // そのまま返す
  }
  // 旧プレフィックス形式が残っていれば変換
  const pg: string = row.product_group || "";
  for (const [ch, prefix] of Object.entries(CHANNEL_PREFIXES)) {
    if (pg.startsWith(prefix)) {
      return { ...row, channel: ch, product_group: pg.slice(prefix.length) };
    }
  }
  return { ...row, channel: row.channel || "total" };
}

export async function getMonthlyGoals(yearMonth: string) {
  const { data, error } = await supabase
    .from("monthly_goals")
    .select("*, product:products(*)")
    .eq("year_month", yearMonth);
  if (error) throw error;
  return (data || []).map(parseGoalRow);
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
 * channel: "amazon" | "rakuten" | "total"（省略時は "total"）
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
  const goalData: Record<string, any> = {
    target_sales: params.target_sales,
    target_orders: params.target_orders,
    target_profit: params.target_profit,
    target_ad_budget: params.target_ad_budget || 0,
  };

  // まずchannel列ありで検索を試みる
  let existing: any = null;
  try {
    const { data } = await supabase
      .from("monthly_goals")
      .select("id")
      .eq("product_group", params.product_group)
      .eq("year_month", params.year_month)
      .eq("channel", channel)
      .is("product_id", null)
      .maybeSingle();
    existing = data;
  } catch {
    // channel列が存在しない場合のフォールバック
    const { data } = await supabase
      .from("monthly_goals")
      .select("id")
      .eq("product_group", params.product_group)
      .eq("year_month", params.year_month)
      .is("product_id", null)
      .maybeSingle();
    existing = data;
  }

  if (existing) {
    const { data, error } = await supabase
      .from("monthly_goals")
      .update(goalData)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) throw error;
    return data as MonthlyGoal;
  } else {
    // channel列つきでINSERTを試みる。失敗したらchannelなしで再試行
    const insertData: Record<string, any> = {
      product_id: null,
      product_group: params.product_group,
      year_month: params.year_month,
      channel,
      ...goalData,
    };

    const { data, error } = await supabase
      .from("monthly_goals")
      .insert(insertData)
      .select()
      .single();

    if (error && error.message?.includes("channel")) {
      // channel列なしで再試行
      delete insertData.channel;
      const { data: data2, error: error2 } = await supabase
        .from("monthly_goals")
        .insert(insertData)
        .select()
        .single();
      if (error2) throw error2;
      return data2 as MonthlyGoal;
    }

    if (error) throw error;
    return data as MonthlyGoal;
  }
}

/** 楽天グループ目標（後方互換のため残す） */
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

/** 楽天目標を取得（後方互換のため残す） */
export async function getRakutenMonthlyGoals(yearMonth: string) {
  const goals = await getMonthlyGoals(yearMonth);
  return (goals || []).filter((g: any) => g.channel === "rakuten");
}
