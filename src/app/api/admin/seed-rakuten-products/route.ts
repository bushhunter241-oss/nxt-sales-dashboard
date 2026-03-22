import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * POST /api/admin/seed-rakuten-products
 * 「商品別_原価_送料まとめ.xlsx」を元に楽天商品マスタを一括登録する。
 * ON CONFLICT (product_id) DO UPDATE なので重複登録は安全。
 *
 * 使い方（デプロイ後にブラウザのコンソールか curl から実行）:
 *   fetch('/api/admin/seed-rakuten-products', { method: 'POST' }).then(r => r.json()).then(console.log)
 *
 * ※ product_id は仮IDです。登録後、商品マスタ管理画面から実際の楽天管理番号に更新してください。
 * ※ selling_price（販売価格）は 0 で登録します。UIから更新してください。
 */

const RAKUTEN_PRODUCTS = [
  // ─── feela ───────────────────────────────────────────────────────────
  {
    name: "feela シートクッション",
    product_id: "feela-seat-cushion",
    product_group: "feela",
    cost_price: 3100,
    shipping_fee: 704,
    selling_price: 0,
    fee_rate: 10,
    category: "クッション",
    is_archived: false,
  },

  // ─── MobiStick ────────────────────────────────────────────────────────
  {
    name: "MobiStick",
    product_id: "mobistick-01",
    product_group: "MobiStick",
    cost_price: 821,
    shipping_fee: 0,   // 送料欄が「—」のため 0 で登録
    selling_price: 0,
    fee_rate: 10,
    category: "その他",
    is_archived: false,
  },

  // ─── imin01（ホワイトセージ系）───────────────────────────────────────
  {
    name: "ホワイトセージ 30g",
    product_id: "imin01-30g",
    product_group: "imin01",
    cost_price: 303,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "ホワイトセージ 50g",
    product_id: "imin01-50g",
    product_group: "imin01",
    cost_price: 441,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "ホワイトセージ 100g",
    product_id: "imin01-100g",
    product_group: "imin01",
    cost_price: 784,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "八角浄化皿 GOLD",
    product_id: "imin01-hakkaku-gold",
    product_group: "imin01",
    cost_price: 474,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "八角浄化皿 WATER",
    product_id: "imin01-hakkaku-water",
    product_group: "imin01",
    cost_price: 455,
    shipping_fee: 527,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "浄め塩 ホワイトセージ 10g",
    product_id: "imin01-kiyome-10g",
    product_group: "imin01",
    cost_price: 79,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "限定セット",
    product_id: "imin01-limited-set",
    product_group: "imin01",
    cost_price: 699,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "クラッシュ",
    product_id: "imin01-crush",
    product_group: "imin01",
    cost_price: 1008,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },

  // ─── imin02 ──────────────────────────────────────────────────────────
  {
    name: "Moon缶",
    product_id: "imin02-moon-can",
    product_group: "imin02",
    cost_price: 499,
    shipping_fee: 527,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "Moon100",
    product_id: "imin02-moon100",
    product_group: "imin02",
    cost_price: 950,
    shipping_fee: 527,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "18g",
    product_id: "imin02-18g",
    product_group: "imin02",
    cost_price: 172,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "35g",
    product_id: "imin02-35g",
    product_group: "imin02",
    cost_price: 316,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },

  // ─── imin03（浄化香系）───────────────────────────────────────────────
  {
    name: "浄化香 2.8mm 33本",
    product_id: "imin03-joka-28mm-33",
    product_group: "imin03",
    cost_price: 256,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "浄化香 2.1mm 40本",
    product_id: "imin03-joka-21mm-40",
    product_group: "imin03",
    cost_price: 278,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "浄化香 80本",
    product_id: "imin03-joka-80",
    product_group: "imin03",
    cost_price: 338,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "浄化香 120本",
    product_id: "imin03-joka-120",
    product_group: "imin03",
    cost_price: 432,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "香立 巳",
    product_id: "imin03-koudai-mi",
    product_group: "imin03",
    cost_price: 372,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "ライター",
    product_id: "imin03-lighter",
    product_group: "imin03",
    cost_price: 480,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },

  // ─── imin05 ──────────────────────────────────────────────────────────
  {
    name: "P-set",
    product_id: "imin05-p-set",
    product_group: "imin05",
    cost_price: 514,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "パウダー",
    product_id: "imin05-powder",
    product_group: "imin05",
    cost_price: 283,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "季節ブレンド",
    product_id: "imin05-seasonal",
    product_group: "imin05",
    cost_price: 283,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
  {
    name: "Gold",
    product_id: "imin05-gold",
    product_group: "imin05",
    cost_price: 412,
    shipping_fee: 251,
    selling_price: 0,
    fee_rate: 10,
    category: "お香・浄化グッズ",
    is_archived: false,
  },
];

export async function POST() {
  try {
    const { data, error } = await supabase
      .from("rakuten_products")
      .upsert(RAKUTEN_PRODUCTS, { onConflict: "product_id" })
      .select("id, name, product_id, product_group, cost_price, shipping_fee");

    if (error) {
      console.error("[seed-rakuten-products] Supabase error:", error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `✅ ${data?.length ?? 0} 件の楽天商品を登録（または更新）しました`,
      registered: data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// GET でも結果確認ができるよう簡易エンドポイントを用意
export async function GET() {
  const { data, error } = await supabase
    .from("rakuten_products")
    .select("id, name, product_id, product_group, cost_price, shipping_fee")
    .order("product_group");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ count: data?.length ?? 0, products: data });
}
