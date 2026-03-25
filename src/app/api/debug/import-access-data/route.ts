import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(request: NextRequest) {
  const db = createClient(supabaseUrl, supabaseAnonKey);
  const records: Array<{ date: string; product_id: string; access_count: number }> = await request.json();

  // product_id → UUID マッピング取得
  const { data: products } = await db
    .from("rakuten_products")
    .select("id, product_id")
    .eq("is_archived", false);

  const pidMap = new Map<string, string>();
  for (const p of products || []) {
    pidMap.set(p.product_id, p.id);
  }

  let updated = 0;
  let inserted = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const rec of records) {
    const uuid = pidMap.get(rec.product_id);
    if (!uuid) {
      skipped++;
      continue;
    }

    // 既存レコード確認
    const { data: existing } = await db
      .from("rakuten_daily_sales")
      .select("id")
      .eq("product_id", uuid)
      .eq("date", rec.date)
      .maybeSingle();

    if (existing) {
      const { error } = await db
        .from("rakuten_daily_sales")
        .update({ access_count: rec.access_count })
        .eq("id", existing.id);
      if (error) {
        errors.push(`${rec.product_id} ${rec.date}: ${error.message}`);
      } else {
        updated++;
      }
    } else {
      const { error } = await db
        .from("rakuten_daily_sales")
        .insert({
          product_id: uuid,
          date: rec.date,
          access_count: rec.access_count,
          orders: 0,
          sales_amount: 0,
          units_sold: 0,
          cvr: 0,
          cancellations: 0,
          source: "rms_scrape",
        });
      if (error) {
        errors.push(`${rec.product_id} ${rec.date}: ${error.message}`);
      } else {
        inserted++;
      }
    }
  }

  return NextResponse.json({
    total: records.length,
    updated,
    inserted,
    skipped,
    errors: errors.slice(0, 20),
  });
}
