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
