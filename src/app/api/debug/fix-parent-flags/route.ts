import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** POST /api/debug/fix-parent-flags — Amazon・楽天両方の親商品フラグを自動修正
 *  Authorization: Bearer ${CRON_SECRET} が必須（商品マスタを書き換えるため）。 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createClient(supabaseUrl, supabaseAnonKey);
  const fixed: string[] = [];

  // === Amazon ===
  const { data: amzProducts } = await db.from("products").select("id, asin, parent_asin, is_parent").eq("is_archived", false);
  const childParentAsins = new Set<string>();
  for (const p of amzProducts || []) { if (p.parent_asin) childParentAsins.add(p.parent_asin); }
  for (const p of (amzProducts || []).filter(p => p.asin && childParentAsins.has(p.asin) && !p.is_parent)) {
    const { error } = await db.from("products").update({ is_parent: true }).eq("id", p.id);
    if (!error) fixed.push(`amazon:${p.asin}`);
  }

  // === 楽天 ===
  const { data: rktProducts } = await db.from("rakuten_products").select("id, product_id, parent_product_id, is_archived");
  const rktChildParentIds = new Set<string>();
  for (const p of rktProducts || []) { if (p.parent_product_id) rktChildParentIds.add(p.parent_product_id); }
  // parent_product_id=nullで、他の商品がこれをparentとして参照している → 親商品
  // rakuten_productsにはis_parent列がないので、表示フィルタはUUID除外で対応

  return NextResponse.json({
    fixed,
    amazon_parent_asins: [...childParentAsins],
    rakuten_parent_product_ids: [...rktChildParentIds],
  });
}
