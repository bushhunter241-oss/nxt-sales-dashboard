import { supabase } from "@/lib/supabase";
import type { ProductEvent } from "@/types/database";

export async function getProductEvents(params: {
  startDate?: string;
  endDate?: string;
  productGroup?: string;
}): Promise<ProductEvent[]> {
  let query = supabase
    .from("product_events")
    .select("*")
    .order("date", { ascending: true });

  if (params.startDate) query = query.gte("date", params.startDate);
  if (params.endDate) query = query.lte("date", params.endDate);
  if (params.productGroup) query = query.eq("product_group", params.productGroup);

  const { data, error } = await query;
  if (error) { console.warn("getProductEvents error:", error); return []; }
  return (data || []) as ProductEvent[];
}

/**
 * Bulk create events via API route (bypasses RLS)
 */
export async function createProductEventsBulk(params: {
  startDate: string;
  endDate: string;
  productGroups: string[];
  event_type: string;
  memo: string;
}): Promise<number> {
  const res = await fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Failed to create events`);
  }
  const data = await res.json();
  return data.count;
}

/**
 * Delete event via API route (bypasses RLS)
 */
export async function deleteProductEvent(id: string): Promise<void> {
  const res = await fetch(`/api/events?id=${id}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Failed to delete event`);
  }
}
