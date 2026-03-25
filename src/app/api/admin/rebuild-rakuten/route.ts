import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { syncRakutenSales } from "@/lib/rakuten/sync";
import type { RakutenCreds } from "@/lib/rakuten/orders";

export const maxDuration = 300;

/**
 * POST /api/admin/rebuild-rakuten
 * 楽天データのクリーンアップ＆再構築。
 *
 * Body options:
 *   step: "backup" | "cleanup" | "seed" | "resync" | "all"
 *   startDate?: string (default "2026-01-01")
 *   endDate?: string   (default today JST)
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const step = body.step || "all";
    const startDate = body.startDate || "2026-01-01";
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const endDate = body.endDate || now.toISOString().split("T")[0];

    const results: Record<string, any> = {};

    // Step 1: バックアップ
    if (step === "backup" || step === "all") {
      const backupResults = await backupTables();
      results.backup = backupResults;
    }

    // Step 2: クリーンアップ
    if (step === "cleanup" || step === "all") {
      const cleanupResults = await cleanupTables();
      results.cleanup = cleanupResults;
    }

    // Step 3: シードデータ登録
    if (step === "seed" || step === "all") {
      const seedRes = await fetch(new URL("/api/admin/seed-rakuten-products", req.url), {
        method: "POST",
      });
      results.seed = await seedRes.json();
    }

    // Step 4: RMS Order APIで再取得
    if (step === "resync" || step === "all") {
      results.resync = await resyncOrders(startDate, endDate);
    }

    return NextResponse.json({
      success: true,
      step,
      dateRange: { startDate, endDate },
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

async function backupTables() {
  const tables = [
    "rakuten_products",
    "rakuten_daily_sales",
    "rakuten_daily_advertising",
    "rakuten_daily_sku_sales",
    "rakuten_sku_costs",
  ];

  const results: Record<string, string> = {};
  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);

  for (const table of tables) {
    const backupName = `${table}_backup_${timestamp}`;
    const { error } = await supabase.rpc("exec_sql", {
      sql: `CREATE TABLE IF NOT EXISTS ${backupName} AS SELECT * FROM ${table}`,
    });
    results[table] = error ? `error: ${error.message}` : `backed up to ${backupName}`;
  }

  return results;
}

async function cleanupTables() {
  const results: Record<string, string> = {};

  // 売上データ削除
  const { error: salesErr } = await supabase
    .from("rakuten_daily_sales")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  results.rakuten_daily_sales = salesErr ? `error: ${salesErr.message}` : "cleared";

  // SKU別売上データ削除
  const { error: skuSalesErr } = await supabase
    .from("rakuten_daily_sku_sales")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  results.rakuten_daily_sku_sales = skuSalesErr ? `error: ${skuSalesErr.message}` : "cleared";

  // 商品マスタ削除（広告データは商品UUIDを参照しているのでproductsより先に削除不可）
  // 広告データは保持（Cowarkが直接書き込んでいるため再取得が難しい）
  // 商品マスタ削除
  const { error: prodErr } = await supabase
    .from("rakuten_products")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  results.rakuten_products = prodErr ? `error: ${prodErr.message}` : "cleared";

  return results;
}

async function resyncOrders(startDate: string, endDate: string) {
  // 認証情報取得
  const { data: cred } = await supabase
    .from("api_credentials")
    .select("credentials")
    .eq("service", "rakuten_rms")
    .maybeSingle();

  if (!cred?.credentials) {
    return { error: "楽天RMS認証情報が見つかりません。api_credentialsテーブルを確認してください。" };
  }

  const rakutenCreds: RakutenCreds = {
    serviceSecret: cred.credentials.serviceSecret || cred.credentials.service_secret,
    licenseKey: cred.credentials.licenseKey || cred.credentials.license_key,
  };

  // 1日ずつ同期（タイムアウト防止）
  const results: Array<{ date: string; result: any }> = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const startTime = Date.now();
  const maxMs = 250_000; // 250秒で中断

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (Date.now() - startTime > maxMs) {
      results.push({
        date: "TIMEOUT",
        result: { message: `タイムアウト: ${d.toISOString().split("T")[0]}まで処理完了` },
      });
      break;
    }

    const dateStr = d.toISOString().split("T")[0];
    try {
      const result = await syncRakutenSales(rakutenCreds, dateStr, dateStr);
      results.push({ date: dateStr, result });
    } catch (err) {
      results.push({
        date: dateStr,
        result: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  return {
    totalDays: results.length,
    results,
  };
}

export async function GET() {
  // 現在のデータ状況を確認
  const [
    { count: productsCount },
    { count: salesCount },
    { count: adCount },
    { count: skuCostsCount },
    { count: skuSalesCount },
  ] = await Promise.all([
    supabase.from("rakuten_products").select("*", { count: "exact", head: true }),
    supabase.from("rakuten_daily_sales").select("*", { count: "exact", head: true }),
    supabase.from("rakuten_daily_advertising").select("*", { count: "exact", head: true }),
    supabase.from("rakuten_sku_costs").select("*", { count: "exact", head: true }),
    supabase.from("rakuten_daily_sku_sales").select("*", { count: "exact", head: true }),
  ]);

  return NextResponse.json({
    status: "ready",
    tables: {
      rakuten_products: productsCount ?? 0,
      rakuten_daily_sales: salesCount ?? 0,
      rakuten_daily_advertising: adCount ?? 0,
      rakuten_sku_costs: skuCostsCount ?? 0,
      rakuten_daily_sku_sales: skuSalesCount ?? 0,
    },
    usage: "POST with { step: 'backup' | 'cleanup' | 'seed' | 'resync' | 'all' }",
  });
}
