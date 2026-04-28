import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createClient(supabaseUrl, supabaseAnonKey);

  const { data: products } = await db.from("products").select("id, name, asin, parent_asin, is_parent, is_archived, product_group").eq("is_archived", false);

  // parent_asinを持つ商品（子ASIN）のparent_asin一覧
  const childParentAsins = new Set<string>();
  for (const p of products || []) {
    if (p.parent_asin) childParentAsins.add(p.parent_asin);
  }

  // 自身のASINが他の商品のparent_asinとして参照されている = 親ASIN
  const shouldBeParent = (products || []).filter(p => p.asin && childParentAsins.has(p.asin));
  const missingParentFlag = shouldBeParent.filter(p => !p.is_parent);

  return NextResponse.json({
    all_products: (products || []).map(p => ({
      name: p.name, asin: p.asin, parent_asin: p.parent_asin, is_parent: p.is_parent, product_group: p.product_group,
    })),
    child_parent_asins: [...childParentAsins],
    should_be_parent: shouldBeParent.map(p => ({ id: p.id, name: p.name, asin: p.asin, is_parent: p.is_parent })),
    missing_parent_flag: missingParentFlag.map(p => ({ id: p.id, name: p.name, asin: p.asin })),
  });
}
