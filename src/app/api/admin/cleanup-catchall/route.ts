import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

/**
 * POST /api/admin/cleanup-catchall
 * Removes daily_sales records linked to "catch-all" products
 * (products with no ASIN, or name containing "キャッチオール" / "catch-all")
 * for a given date range. This prepares the data for proper ASIN-based re-sync.
 */
export async function POST(request: NextRequest) {
  try {
    const { startDate, endDate } = await request.json();
    if (!startDate || !endDate) {
      return NextResponse.json({ error: "startDate and endDate required" }, { status: 400 });
    }

    const db = getSupabaseAdmin();

    // 1. Find catch-all products (no ASIN set, or name matches catch-all patterns)
    const { data: catchAllProducts } = await db
      .from("products")
      .select("id, name, asin")
      .or("asin.is.null,name.ilike.%キャッチオール%,name.ilike.%catch-all%,name.ilike.%catchall%");

    if (!catchAllProducts || catchAllProducts.length === 0) {
      return NextResponse.json({
        message: "No catch-all products found",
        deletedRecords: 0,
      });
    }

    const catchAllIds = catchAllProducts.map((p) => p.id);
    console.log(`[Cleanup] Found ${catchAllIds.length} catch-all products:`,
      catchAllProducts.map((p) => `${p.name} (asin: ${p.asin || "null"})`));

    // 2. Delete daily_sales records for these products in the date range
    const { data: deleted, error } = await db
      .from("daily_sales")
      .delete()
      .in("product_id", catchAllIds)
      .gte("date", startDate)
      .lte("date", endDate)
      .select("id");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const deletedCount = deleted?.length || 0;
    console.log(`[Cleanup] Deleted ${deletedCount} daily_sales records for catch-all products`);

    // 3. Optionally archive catch-all products (mark inactive)
    if (deletedCount > 0) {
      await db
        .from("products")
        .update({ is_archived: true })
        .in("id", catchAllIds);
      console.log(`[Cleanup] Archived ${catchAllIds.length} catch-all products`);
    }

    return NextResponse.json({
      message: `Cleaned up ${deletedCount} records from ${catchAllProducts.length} catch-all products`,
      deletedRecords: deletedCount,
      archivedProducts: catchAllProducts.map((p) => p.name),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
