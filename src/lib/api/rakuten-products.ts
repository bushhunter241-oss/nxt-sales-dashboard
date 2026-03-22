import { supabase } from "@/lib/supabase";
import { RakutenProduct } from "@/types/database";

export async function getRakutenProducts(includeArchived = false) {
  let query = supabase.from("rakuten_products").select("*").order("name");
  if (!includeArchived) {
    query = query.eq("is_archived", false);
  }
  const { data, error } = await query;
  if (error) { console.warn("getRakutenProducts error:", error); return [] as RakutenProduct[]; }
  return (data || []) as RakutenProduct[];
}

export async function createRakutenProduct(product: Omit<RakutenProduct, "id" | "created_at" | "updated_at">) {
  const { data, error } = await supabase.from("rakuten_products").insert(product).select().single();
  if (error) throw error;
  return data as RakutenProduct;
}

export async function updateRakutenProduct(id: string, updates: Partial<RakutenProduct>) {
  const { data, error } = await supabase.from("rakuten_products").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data as RakutenProduct;
}

export async function deleteRakutenProduct(id: string) {
  const { error } = await supabase.from("rakuten_products").delete().eq("id", id);
  if (error) throw error;
}
