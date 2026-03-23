import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchRakutenOrders } from "@/lib/rakuten/orders";

/**
 * POST /api/rakuten/debug-orders
 * デバッグ用: 注文データのクーポン・価格フィールドを確認
 * body: { date: string, limit?: number }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const date = (body as { date?: string }).date || "2026-03-05";
    const limit = (body as { limit?: number }).limit || 3;

    const { data: cred } = await supabase
      .from("rakuten_api_credentials")
      .select("*")
      .single();

    if (!cred) {
      return NextResponse.json({ error: "No credentials" }, { status: 400 });
    }

    const creds = {
      serviceSecret: cred.service_secret,
      licenseKey: cred.license_key,
    };

    const orders = await fetchRakutenOrders(creds, date, date);

    const sample = orders.slice(0, limit).map((o) => ({
      orderNumber: o.orderNumber,
      totalPrice: o.totalPrice,
      goodsPrice: o.goodsPrice,
      goodsTax: o.goodsTax,
      requestPrice: o.requestPrice,
      couponAllTotalPrice: o.couponAllTotalPrice,
      pointAmount: o.pointAmount,
      status: o.status,
      items: (o.PackageModelList || []).flatMap((p) =>
        (p.ItemModelList || []).map((i) => ({
          name: i.itemName?.substring(0, 30),
          manageNumber: i.manageNumber,
          price: i.price,
          priceTaxIncl: i.priceTaxIncl,
          units: i.units,
          taxPrice: i.taxPrice,
          sku: i.SkuModelList?.[0]?.merchantDefinedSkuId,
        }))
      ),
    }));

    return NextResponse.json({
      date,
      totalOrders: orders.length,
      sample,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}
