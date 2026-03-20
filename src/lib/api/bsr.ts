import { supabase } from "@/lib/supabase";
import type { BsrRanking } from "@/types/database";

/**
 * Get BSR rankings for all products within a date range
 */
export async function getBsrRankings(
  startDate: string,
  endDate: string
): Promise<(BsrRanking & { product: { name: string; asin: string; parent_asin: string | null; product_group: string | null } })[]> {
  const { data, error } = await supabase
    .from("bsr_rankings")
    .select("*, product:products(name, asin, parent_asin, product_group)")
    .gte("recorded_at", startDate + "T00:00:00Z")
    .lte("recorded_at", endDate + "T23:59:59Z")
    .order("recorded_at", { ascending: true });

  if (error) {
    console.error("getBsrRankings error:", error);
    return [];
  }

  return (data || []) as (BsrRanking & { product: { name: string; asin: string; parent_asin: string | null; product_group: string | null } })[];
}

/**
 * Get the latest BSR ranking for each product
 */
export async function getLatestBsr(): Promise<
  (BsrRanking & { product: { name: string; asin: string } })[]
> {
  // Get distinct product_ids with their latest recorded_at
  const { data, error } = await supabase
    .from("bsr_rankings")
    .select("*, product:products(name, asin)")
    .order("recorded_at", { ascending: false });

  if (error) {
    console.error("getLatestBsr error:", error);
    return [];
  }

  // Deduplicate: keep only the latest record per product+category
  const seen = new Set<string>();
  const latest: typeof data = [];

  for (const row of data || []) {
    const key = `${row.product_id}_${row.category_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      latest.push(row);
    }
  }

  return latest as (BsrRanking & { product: { name: string; asin: string } })[];
}
