import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * POST /api/admin/seed-rakuten-products
 * 楽天商品マスタ（manageNumberベース）+ SKU別原価テーブルを一括登録。
 * imin01/02/03のUUIDはCowark RPP ad syncタスクとの互換性のため固定。
 */

// 商品マスタ: manageNumber = product_id
const RAKUTEN_PRODUCTS = [
  {
    id: undefined as string | undefined,
    name: "feela シートクッション",
    product_id: "feela01",
    product_group: "feela",
    cost_price: 3100,
    shipping_fee: 704,
    selling_price: 8980,
    fee_rate: 10,
    category: "クッション",
    is_archived: false,
  },
  {
    id: "5c695c77-924e-4581-96cb-f1bd90e4faca", // Cowark RPP UUID
    name: "imin ホワイトセージ お得パック",
    product_id: "imin01",
    product_group: "imin01",
    cost_price: 623,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    id: "a04350f5-b0b5-4ce1-b3f0-cf4b26209b9f", // Cowark RPP UUID
    name: "imin Moon",
    product_id: "imin02",
    product_group: "imin02",
    cost_price: 484,
    shipping_fee: 389,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    id: "d5c6467f-d9ab-4b42-904d-0736742b27bf", // Cowark RPP UUID
    name: "imin 浄化香",
    product_id: "imin03",
    product_group: "imin03",
    cost_price: 359,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    id: undefined as string | undefined,
    name: "imin 浄化パウダー・その他",
    product_id: "imin05",
    product_group: "imin05",
    cost_price: 373,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    id: undefined as string | undefined,
    name: "imin ライター",
    product_id: "imin06",
    product_group: "imin06",
    cost_price: 480,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
];

// SKU別原価テーブル
const RAKUTEN_SKU_COSTS = [
  // imin01
  { manage_number: "imin01", sku_id: "imin01:sage-30g", sku_label: "ホワイトセージ 30g", cost_price: 303, shipping_fee: 251 },
  { manage_number: "imin01", sku_id: "imin01:sage-50g", sku_label: "ホワイトセージ 50g", cost_price: 441, shipping_fee: 251 },
  { manage_number: "imin01", sku_id: "imin01:sage-100g", sku_label: "ホワイトセージ 100g", cost_price: 784, shipping_fee: 251 },
  { manage_number: "imin01", sku_id: "imin01:hakkaku-gold", sku_label: "八角浄化皿 GOLD", cost_price: 474, shipping_fee: 251 },
  { manage_number: "imin01", sku_id: "imin01:hakkaku-water", sku_label: "八角浄化皿 WATER", cost_price: 455, shipping_fee: 527 },
  { manage_number: "imin01", sku_id: "imin01:kiyome-10g", sku_label: "浄め塩 10g", cost_price: 79, shipping_fee: 251 },
  { manage_number: "imin01", sku_id: "imin01:limited-set", sku_label: "限定セット", cost_price: 699, shipping_fee: 251 },
  { manage_number: "imin01", sku_id: "imin01:crush", sku_label: "クラッシュ", cost_price: 1008, shipping_fee: 251 },
  // imin02
  { manage_number: "imin02", sku_id: "imin02:moon-can", sku_label: "Moon缶", cost_price: 499, shipping_fee: 527 },
  { manage_number: "imin02", sku_id: "imin02:moon100", sku_label: "Moon100", cost_price: 950, shipping_fee: 527 },
  { manage_number: "imin02", sku_id: "imin02:18g", sku_label: "18g", cost_price: 172, shipping_fee: 251 },
  { manage_number: "imin02", sku_id: "imin02:35g", sku_label: "35g", cost_price: 316, shipping_fee: 251 },
  // imin03
  { manage_number: "imin03", sku_id: "imin03:joka-28mm-33", sku_label: "浄化香 2.8mm 33本", cost_price: 256, shipping_fee: 251 },
  { manage_number: "imin03", sku_id: "imin03:joka-21mm-40", sku_label: "浄化香 2.1mm 40本", cost_price: 278, shipping_fee: 251 },
  { manage_number: "imin03", sku_id: "imin03:joka-80", sku_label: "浄化香 80本", cost_price: 338, shipping_fee: 251 },
  { manage_number: "imin03", sku_id: "imin03:joka-120", sku_label: "浄化香 120本", cost_price: 432, shipping_fee: 251 },
  { manage_number: "imin03", sku_id: "imin03:koudai-mi", sku_label: "香立 巳", cost_price: 372, shipping_fee: 251 },
  { manage_number: "imin03", sku_id: "imin03:lighter", sku_label: "ライター", cost_price: 480, shipping_fee: 251 },
  // imin05
  { manage_number: "imin05", sku_id: "imin05:p-set", sku_label: "P-set", cost_price: 514, shipping_fee: 251 },
  { manage_number: "imin05", sku_id: "imin05:powder", sku_label: "パウダー", cost_price: 283, shipping_fee: 251 },
  { manage_number: "imin05", sku_id: "imin05:seasonal", sku_label: "季節ブレンド", cost_price: 283, shipping_fee: 251 },
  { manage_number: "imin05", sku_id: "imin05:gold", sku_label: "Gold", cost_price: 412, shipping_fee: 251 },
  // feela01
  { manage_number: "feela01", sku_id: "feela01:seat-cushion", sku_label: "シートクッション", cost_price: 3100, shipping_fee: 704 },
];

export async function POST() {
  try {
    // 1. 商品マスタ登録（idが指定されているものはそのUUIDで登録）
    const productsToInsert = RAKUTEN_PRODUCTS.map(p => {
      const record: any = { ...p };
      if (!record.id) delete record.id; // UUIDが未指定ならDBに自動生成させる
      return record;
    });

    const { data: products, error: prodError } = await supabase
      .from("rakuten_products")
      .upsert(productsToInsert, { onConflict: "product_id" })
      .select("id, name, product_id, product_group, cost_price, shipping_fee");

    if (prodError) {
      return NextResponse.json({ success: false, error: prodError.message }, { status: 500 });
    }

    // 2. SKU別原価テーブル登録
    const { data: skuCosts, error: skuError } = await supabase
      .from("rakuten_sku_costs")
      .upsert(RAKUTEN_SKU_COSTS, { onConflict: "manage_number,sku_id" })
      .select("manage_number, sku_id, sku_label, cost_price, shipping_fee");

    if (skuError) {
      return NextResponse.json({
        success: false,
        error: `商品マスタ登録OK, SKUコスト登録エラー: ${skuError.message}`,
        products,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `商品 ${products?.length ?? 0}件、SKUコスト ${skuCosts?.length ?? 0}件を登録`,
      products,
      skuCosts: skuCosts?.length ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  const [{ data: products, error: prodErr }, { data: skuCosts, error: skuErr }] = await Promise.all([
    supabase.from("rakuten_products").select("id, name, product_id, product_group, cost_price, shipping_fee").eq("is_archived", false).order("product_group"),
    supabase.from("rakuten_sku_costs").select("*").order("manage_number"),
  ]);

  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 });

  return NextResponse.json({
    products: { count: products?.length ?? 0, data: products },
    skuCosts: { count: skuCosts?.length ?? 0, data: skuCosts, error: skuErr?.message },
  });
}
