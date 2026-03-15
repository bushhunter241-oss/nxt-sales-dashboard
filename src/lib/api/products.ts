import { supabase } from "@/lib/supabase";
import { Product } from "@/types/database";

export async function getProducts(includeArchived = false) {
  let query = supabase.from("products").select("*").order("name");
  if (!includeArchived) {
    query = query.eq("is_archived", false);
  }
  const { data, error } = await query;
  if (error) { console.warn("getProducts error:", error); return [] as Product[]; }
  return (data || []) as Product[];
}

export async function getProduct(id: string) {
  const { data, error } = await supabase.from("products").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Product;
}

export async function createProduct(product: Omit<Product, "id" | "created_at" | "updated_at">) {
  const { data, error } = await supabase.from("products").insert(product).select().single();
  if (error) throw error;
  return data as Product;
}

export async function updateProduct(id: string, updates: Partial<Product>) {
  const { data, error } = await supabase.from("products").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data as Product;
}

export async function deleteProduct(id: string) {
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw error;
}
