import { supabase } from "@/lib/supabase";

export interface ProductGroup {
  id: string;
  name: string;
  created_at: string;
}

export async function getProductGroups(): Promise<ProductGroup[]> {
  const { data, error } = await supabase
    .from("product_groups")
    .select("*")
    .order("name");
  if (error) { console.warn("getProductGroups error:", error); return []; }
  return (data || []) as ProductGroup[];
}

export async function createProductGroup(name: string): Promise<ProductGroup> {
  const { data, error } = await supabase
    .from("product_groups")
    .upsert({ name }, { onConflict: "name" })
    .select()
    .single();
  if (error) throw error;
  return data as ProductGroup;
}

export async function deleteProductGroup(id: string): Promise<void> {
  const { error } = await supabase
    .from("product_groups")
    .delete()
    .eq("id", id);
  if (error) throw error;
}
