import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * POST: imin お香シリーズの修正を実行
 * - 重複商品 imin_incense をアーカイブ
 * - parent_product_idの不整合修正（文字列 "imin03" → UUID参照に統一）
 */
export async function POST(request: NextRequest) {
  const db = createClient(supabaseUrl, supabaseAnonKey);
  const body = await request.json().catch(() => ({}));
  const { action } = body;

  const results: string[] = [];

  if (action === "archive_duplicate" || action === "all") {
    // imin_incense（40hと重複）をアーカイブ
    const { error } = await db
      .from("rakuten_products")
      .update({ is_archived: true })
      .eq("product_id", "imin_incense");

    if (error) {
      results.push(`imin_incense アーカイブ失敗: ${error.message}`);
    } else {
      results.push("imin_incense をアーカイブしました");
    }
  }

  if (action === "fix_parent_refs" || action === "all") {
    // parent_product_id が文字列 "imin03" のものを UUID に統一
    const IMIN03_UUID = "d5c6467f-d9ab-4b42-904d-0736742b27bf";

    const { data: toFix } = await db
      .from("rakuten_products")
      .select("id, product_id, parent_product_id")
      .eq("parent_product_id", "imin03");

    for (const p of toFix || []) {
      const { error } = await db
        .from("rakuten_products")
        .update({ parent_product_id: IMIN03_UUID })
        .eq("id", p.id);

      if (error) {
        results.push(`${p.product_id} parent修正失敗: ${error.message}`);
      } else {
        results.push(`${p.product_id}: parent_product_id を UUID に修正`);
      }
    }
  }

  if (action === "resync_recent" || action === "all") {
    // 直近のRMS API再同期をトリガー（手動でcron syncを呼ぶのと同等）
    results.push("直近データの再同期は /api/cron/sync を手動実行するか、API連携設定ページから楽天同期を実行してください");
  }

  return NextResponse.json({
    success: true,
    actions: results,
    available_actions: ["archive_duplicate", "fix_parent_refs", "resync_recent", "all"],
  });
}
