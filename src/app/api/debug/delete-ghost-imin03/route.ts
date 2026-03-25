import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const IMIN03_UUID = "d5c6467f-d9ab-4b42-904d-0736742b27bf";

/**
 * GET: ゴーストレコードの確認
 * POST: ゴーストレコードの削除
 */
export async function GET() {
  const db = createClient(supabaseUrl, supabaseAnonKey);

  const { data: ghosts } = await db
    .from("rakuten_daily_sales")
    .select("id, date, sales_amount, units_sold, source")
    .eq("product_id", IMIN03_UUID)
    .in("date", ["2026-02-11", "2026-02-12", "2026-02-18", "2026-02-24", "2026-02-25"])
    .eq("sales_amount", 30618)
    .eq("units_sold", 12);

  return NextResponse.json({
    ghost_records: ghosts,
    count: (ghosts || []).length,
  });
}

export async function POST() {
  const db = createClient(supabaseUrl, supabaseAnonKey);

  const { data: ghosts } = await db
    .from("rakuten_daily_sales")
    .select("id")
    .eq("product_id", IMIN03_UUID)
    .in("date", ["2026-02-11", "2026-02-12", "2026-02-18", "2026-02-24", "2026-02-25"])
    .eq("sales_amount", 30618)
    .eq("units_sold", 12);

  const ids = (ghosts || []).map(r => r.id);
  let deleted = 0;

  for (const id of ids) {
    const { error } = await db
      .from("rakuten_daily_sales")
      .delete()
      .eq("id", id);
    if (!error) deleted++;
  }

  return NextResponse.json({
    deleted,
    total_candidates: ids.length,
  });
}
