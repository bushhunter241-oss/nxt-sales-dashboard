import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action") || "check";

  if (action === "check") {
    const { count: totalCount } = await supabase
      .from("daily_sales")
      .select("*", { count: "exact", head: true });

    const { data: minMax } = await supabase
      .from("daily_sales")
      .select("date")
      .order("date", { ascending: true })
      .limit(1);

    const { data: maxDate } = await supabase
      .from("daily_sales")
      .select("date")
      .order("date", { ascending: false })
      .limit(1);

    const { data: recent } = await supabase
      .from("daily_sales")
      .select("id, date, sales_amount, units_sold, orders, source, product:products(name,code,cost_price)")
      .order("date", { ascending: false })
      .limit(20);

    const { data: allData } = await supabase
      .from("daily_sales")
      .select("source")
      .limit(5000);

    const sourceCounts: Record<string, number> = {};
    (allData || []).forEach((r: any) => {
      const s = r.source || "null";
      sourceCounts[s] = (sourceCounts[s] || 0) + 1;
    });

    return NextResponse.json({
      totalRecords: totalCount,
      dateRange: { min: minMax?.[0]?.date || null, max: maxDate?.[0]?.date || null },
      sourceCounts,
      recent: recent || [],
    });
  }

  if (action === "count-products") {
    const { data } = await supabase
      .from("products")
      .select("id, name, code, cost_price, asin, is_archived")
      .order("name");
    return NextResponse.json({ products: data });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// POST: Bulk insert daily_sales
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { rows } = body; // Array of { asin, date, sessions, orders, sales_amount, units_sold }

    if (!rows || !Array.isArray(rows)) {
      return NextResponse.json({ error: "rows array required" }, { status: 400 });
    }

    // Get all products with ASIN
    const { data: products } = await supabase
      .from("products")
      .select("id, asin")
      .eq("is_archived", false);

    const asinToProduct: Record<string, string> = {};
    for (const p of products || []) {
      if (p.asin) asinToProduct[p.asin] = p.id;
    }

    let imported = 0;
    const errors: string[] = [];

    for (const row of rows) {
      const productId = asinToProduct[row.asin];
      if (!productId) {
        errors.push(`ASIN ${row.asin} not found`);
        continue;
      }

      const { error } = await supabase
        .from("daily_sales")
        .upsert({
          product_id: productId,
          date: row.date,
          sessions: row.sessions || 0,
          orders: row.orders || 0,
          sales_amount: row.sales_amount || 0,
          units_sold: row.units_sold || 0,
          cvr: row.cvr || 0,
          cancellations: 0,
          source: "csv-reimport",
        }, { onConflict: "product_id,date" });

      if (error) {
        errors.push(`${row.asin}/${row.date}: ${error.message}`);
      } else {
        imported++;
      }
    }

    return NextResponse.json({ imported, errors: errors.length > 0 ? errors : undefined, total: rows.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
