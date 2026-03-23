import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { syncRakutenSales } from "@/lib/rakuten/sync";
import { fetchRakutenOrders } from "@/lib/rakuten/orders";

export const maxDuration = 120;

/** 日付文字列を1日進める */
function nextDay(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split("T")[0];
}

/** 2つの日付間の日数 */
function daysBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.floor((b - a) / 86400000) + 1;
}

/**
 * POST /api/rakuten/sync
 * 楽天売上データを同期
 * body: { dateFrom?: string, dateTo?: string }
 *
 * 日付範囲が2日以上の場合は1日ずつループ（タイムアウト防止）
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { dateFrom, dateTo } = body as {
      dateFrom?: string;
      dateTo?: string;
    };

    // デフォルト: 昨日
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const defaultDate = yesterday.toISOString().split("T")[0];

    const from = dateFrom || defaultDate;
    const to = dateTo || dateFrom || defaultDate;

    // 認証情報取得
    const { data: cred, error: credError } = await supabase
      .from("rakuten_api_credentials")
      .select("*")
      .single();

    if (credError || !cred) {
      return NextResponse.json(
        { success: false, message: "楽天API認証情報が設定されていません" },
        { status: 400 }
      );
    }

    const creds = {
      serviceSecret: cred.service_secret,
      licenseKey: cred.license_key,
    };

    const totalDays = daysBetween(from, to);

    // 1日だけの場合はそのまま同期
    if (totalDays <= 1) {
      const result = await syncRakutenSales(creds, from, to);
      return NextResponse.json(result);
    }

    // 複数日の場合は1日ずつループ
    let totalOrders = 0;
    let totalProducts = 0;
    let totalSales = 0;
    let processedDays = 0;
    const errors: string[] = [];
    const startTime = Date.now();

    let currentDate = from;
    while (currentDate <= to) {
      // タイムアウト防止: 100秒経過したら中断
      if (Date.now() - startTime > 100000) {
        return NextResponse.json({
          success: true,
          message: `時間切れ: ${processedDays}/${totalDays}日処理完了 (${from}〜${currentDate}), 受注${totalOrders}件, 売上${totalSales}件登録`,
          ordersCount: totalOrders,
          productsUpserted: totalProducts,
          salesUpserted: totalSales,
          partial: true,
          lastProcessedDate: currentDate,
        });
      }

      const result = await syncRakutenSales(creds, currentDate, currentDate);

      if (result.success) {
        totalOrders += result.ordersCount || 0;
        totalProducts += result.productsUpserted || 0;
        totalSales += result.salesUpserted || 0;
      } else {
        errors.push(`${currentDate}: ${result.message}`);
      }

      processedDays++;
      currentDate = nextDay(currentDate);
    }

    const msg = errors.length > 0
      ? `${processedDays}日処理 (一部エラー: ${errors.length}件), 受注${totalOrders}件, 売上${totalSales}件登録`
      : `${processedDays}日分完了: 受注${totalOrders}件, 商品${totalProducts}件新規, 売上${totalSales}件登録`;

    return NextResponse.json({
      success: errors.length === 0,
      message: msg,
      ordersCount: totalOrders,
      productsUpserted: totalProducts,
      salesUpserted: totalSales,
      processedDays,
      totalDays,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "同期に失敗しました";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

/**
 * GET /api/rakuten/sync?date=2026-03-05&limit=3
 * デバッグ用: 注文データのクーポン・価格フィールドを確認
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date") || "2026-03-05";
    const limit = parseInt(url.searchParams.get("limit") || "3");

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
