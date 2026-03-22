import { supabase } from "@/lib/supabase";
import { MonthlyGoal } from "@/types/database";

export async function getMonthlyGoals(yearMonth: string) {
  const { data, error } = await supabase
    .from("monthly_goals")
    .select("*, product:products(*)")
    .eq("year_month", yearMonth);
  if (error) throw error;
  return data;
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
 * Upsert a group-level goal (product_id = null, product_group = group name)
 */
export async function upsertGroupGoal(params: {
  product_group: string;
  year_month: string;
  target_sales: number;
  target_orders: number;
  target_profit: number;
  target_ad_budget?: number;
}) {
  const goalData = {
    target_sales: params.target_sales,
    target_orders: params.target_orders,
    target_profit: params.target_profit,
    target_ad_budget: params.target_ad_budget || 0,
  };

  const { data: existing } = await supabase
    .from("monthly_goals")
    .select("id")
    .eq("product_group", params.product_group)
    .eq("year_month", params.year_month)
    .is("product_id", null)
    .maybeSingle();

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
    if (error) throw error;
    return data as MonthlyGoal;
  }
}
