import { NextRequest, NextResponse } from "next/server";
import { syncShopifySales } from "@/lib/shopify/sync";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const { dateFrom, dateTo } = await request.json().catch(() => ({}));
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const from = dateFrom || yesterday;
    const to = dateTo || yesterday;

    const result = await syncShopifySales(from, to);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Shopify同期エラー" },
      { status: 500 }
    );
  }
}
