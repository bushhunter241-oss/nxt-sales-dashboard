import { supabase } from "@/lib/supabase";
import { Inventory, InventoryLog } from "@/types/database";

export async function getInventory() {
  const { data, error } = await supabase
    .from("inventory")
    .select("*, product:products(*)")
    .order("current_stock", { ascending: true });
  if (error) { console.warn("getInventory error:", error); return []; }
  // アーカイブ商品を除外
  return (data || []).filter((inv: any) => !inv.product?.is_archived);
}

export async function upsertInventory(inv: Omit<Inventory, "id" | "updated_at">) {
  const { data, error } = await supabase
    .from("inventory")
    .upsert(inv, { onConflict: "product_id" })
    .select()
    .single();
  if (error) throw error;
  return data as Inventory;
}

export async function getInventoryLogs(productId?: string) {
  let query = supabase
    .from("inventory_logs")
    .select("*, product:products(*)")
    .order("date", { ascending: false })
    .limit(100);

  if (productId) query = query.eq("product_id", productId);

  const { data, error } = await query;
  if (error) { console.warn("getInventoryLogs error:", error); return []; }
  return data || [];
}

export async function createInventoryLog(log: Omit<InventoryLog, "id" | "created_at">) {
  const { data: logData, error: logError } = await supabase
    .from("inventory_logs")
    .insert(log)
    .select()
    .single();
  if (logError) throw logError;

  // Update current stock
  const { data: inv } = await supabase
    .from("inventory")
    .select("current_stock")
    .eq("product_id", log.product_id)
    .single();

  if (inv) {
    const newStock = inv.current_stock + log.change_amount;
    await supabase
      .from("inventory")
      .update({ current_stock: newStock })
      .eq("product_id", log.product_id);
  }

  return logData;
}
