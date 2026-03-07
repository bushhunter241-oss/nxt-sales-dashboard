import { supabase } from "@/lib/supabase";
import { Expense } from "@/types/database";

export async function getExpenses(params: {
  startDate?: string;
  endDate?: string;
  productId?: string;
}) {
  let query = supabase
    .from("expenses")
    .select("*, product:products(*)")
    .order("date", { ascending: false });

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);
  if (params.productId) query = query.eq("product_id", params.productId);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createExpense(expense: Omit<Expense, "id" | "created_at">) {
  const { data, error } = await supabase.from("expenses").insert(expense).select().single();
  if (error) throw error;
  return data as Expense;
}

export async function deleteExpense(id: string) {
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) throw error;
}

export async function getExpenseSummary(params: {
  startDate?: string;
  endDate?: string;
}) {
  let query = supabase.from("expenses").select("amount, expense_type");
  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);

  const { data, error } = await query;
  if (error) throw error;

  return (data || []).reduce(
    (acc, row) => {
      acc.total += row.amount;
      if (row.expense_type === 'fee') acc.fees += row.amount;
      if (row.expense_type === 'shipping') acc.shipping += row.amount;
      if (row.expense_type === 'other') acc.other += row.amount;
      return acc;
    },
    { total: 0, fees: 0, shipping: 0, other: 0 }
  );
}
