import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/events — Bulk create product events (bypasses RLS)
 */
export async function POST(request: NextRequest) {
  try {
    const { startDate, endDate, productGroups, event_type, memo, product_id, title, discount_rate, channel } = await request.json();

    if (!startDate || !productGroups?.length || !event_type) {
      return NextResponse.json({ error: "startDate, productGroups, event_type are required" }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    const rows: { date: string; product_group: string; event_type: string; memo: string; product_id: string | null; title: string; discount_rate: number; channel: string }[] = [];
    const current = new Date(startDate + "T00:00:00Z");
    const end = new Date((endDate || startDate) + "T00:00:00Z");

    while (current <= end) {
      const dateStr = current.toISOString().split("T")[0];
      for (const group of productGroups) {
        rows.push({
          date: dateStr, product_group: group, event_type, memo: memo || "",
          product_id: product_id || null, title: title || "", discount_rate: discount_rate || 0, channel: channel || "both",
        });
      }
      current.setUTCDate(current.getUTCDate() + 1);
    }

    if (rows.length === 0) {
      return NextResponse.json({ count: 0 });
    }

    const { error } = await db.from("product_events").insert(rows);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ count: rows.length });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/events?id=xxx — Delete a single product event (bypasses RLS)
 */
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const db = getSupabaseAdmin();
    const { error } = await db.from("product_events").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
