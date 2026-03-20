import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getActualFbaFees } from "@/lib/amazon/sp-api";

/**
 * POST /api/sync/fba-fees
 * SP-API Finances API からFBA配送手数料（実費）を取得し、
 * 商品マスタの fba_shipping_fee を自動更新する
 *
 * Body: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { startDate, endDate } = body;

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: "startDate と endDate は必須です" },
        { status: 400 }
      );
    }

    console.log(`[FBA Fees Sync] Fetching actual FBA fees for ${startDate} to ${endDate}`);

    // 1. SP-API Finances API から実際のFBA送料を取得
    const fbaFees = await getActualFbaFees(startDate, endDate);

    if (fbaFees.length === 0) {
      return NextResponse.json({
        success: true,
        message: "指定期間にFBAフィナンシャルイベントが見つかりませんでした",
        updated: 0,
        fees: [],
      });
    }

    console.log(`[FBA Fees Sync] Found ${fbaFees.length} SKUs with FBA fees`);
    console.log("[FBA Fees Sync] Fee details:", fbaFees);

    // 2. 全商品を取得（SKU → product_id のマッピング）
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, sku, asin, name, fba_shipping_fee")
      .eq("is_archived", false);

    if (productsError) {
      throw new Error(`商品マスタ取得エラー: ${productsError.message}`);
    }

    // 3. SKUで商品を更新
    const updateResults: Array<{
      sku: string;
      productName: string;
      oldFee: number;
      newFee: number;
      updated: boolean;
    }> = [];

    for (const feeData of fbaFees) {
      // SKUで商品を検索
      const product = products?.find((p) => p.sku === feeData.sku);

      if (!product) {
        console.log(`[FBA Fees Sync] SKU ${feeData.sku} に対応する商品が見つかりません`);
        continue;
      }

      const newFee = feeData.avgFbaShippingFeePerUnit;
      const oldFee = product.fba_shipping_fee || 0;

      // 変更がある場合のみ更新
      if (newFee !== oldFee) {
        const { error: updateError } = await supabase
          .from("products")
          .update({ fba_shipping_fee: newFee })
          .eq("id", product.id);

        if (updateError) {
          console.error(`[FBA Fees Sync] 更新失敗 ${product.name}: ${updateError.message}`);
          updateResults.push({
            sku: feeData.sku,
            productName: product.name,
            oldFee,
            newFee,
            updated: false,
          });
        } else {
          console.log(`[FBA Fees Sync] ${product.name}: ¥${oldFee} → ¥${newFee}/個`);
          updateResults.push({
            sku: feeData.sku,
            productName: product.name,
            oldFee,
            newFee,
            updated: true,
          });
        }
      } else {
        updateResults.push({
          sku: feeData.sku,
          productName: product.name,
          oldFee,
          newFee,
          updated: false,
        });
      }
    }

    const updatedCount = updateResults.filter((r) => r.updated).length;

    return NextResponse.json({
      success: true,
      message: `FBA配送手数料を${updatedCount}件更新しました`,
      updated: updatedCount,
      fees: fbaFees,
      results: updateResults,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[FBA Fees Sync] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/sync/fba-fees
 * 現在の商品マスタのFBA送料設定を確認する（テスト用）
 */
export async function GET() {
  const { data: products, error } = await supabase
    .from("products")
    .select("id, name, sku, asin, fba_shipping_fee")
    .eq("is_archived", false)
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    products: products || [],
    note: "fba_shipping_fee は1個あたりのFBA配送手数料（円）。0の場合は未設定。",
  });
}
