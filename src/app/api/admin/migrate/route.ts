import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/admin/migrate
 * Supabase Management API経由でDDLマイグレーションを実行する
 * SUPABASE_SERVICE_ROLE_KEY が必要（Vercel環境変数に設定すること）
 *
 * Claude CodeはこのAPIを呼び出してDBマイグレーションを適用できる:
 *   curl -X POST https://nxt-sales-dashboard.vercel.app/api/admin/migrate \
 *     -H "Content-Type: application/json" \
 *     -d '{"migration": "006_add_fba_shipping_fee"}'
 */

const MIGRATIONS: Record<string, string> = {
  "006_add_fba_shipping_fee": `
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS fba_shipping_fee INTEGER NOT NULL DEFAULT 0;
    COMMENT ON COLUMN products.fba_shipping_fee
      IS 'FBA配送手数料（1個あたりの固定額、単位：円）。Amazonが実際に請求するFBA送料。紹介料(fba_fee_rate)とは別。';
  `,
};

export async function POST(request: NextRequest) {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY が設定されていません。Vercelの環境変数を確認してください。" },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { migration } = body;

  if (!migration) {
    return NextResponse.json(
      {
        error: "migration パラメータが必要です",
        available: Object.keys(MIGRATIONS),
      },
      { status: 400 }
    );
  }

  const sql = MIGRATIONS[migration];
  if (!sql) {
    return NextResponse.json(
      { error: `不明なマイグレーション: ${migration}`, available: Object.keys(MIGRATIONS) },
      { status: 400 }
    );
  }

  try {
    // Supabase Management API
    const projectRef = supabaseUrl?.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
    if (!projectRef) throw new Error("Project refを取得できません");

    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ query: sql }),
    });

    const result = await res.json();

    if (res.ok) {
      return NextResponse.json({
        success: true,
        migration,
        message: `Migration ${migration} を正常に適用しました`,
        result,
      });
    } else {
      return NextResponse.json(
        { error: `Migration失敗: ${JSON.stringify(result)}` },
        { status: 500 }
      );
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/migrate
 * マイグレーション適用状況を確認する
 */
export async function GET() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xohafbyqdsmcahovbdhi.supabase.co";

  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY が未設定。/api/debug を使ってください。" },
      { status: 500 }
    );
  }

  // productsテーブルのカラム一覧を確認
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({
      query: `SELECT column_name, data_type, column_default
              FROM information_schema.columns
              WHERE table_name = 'products'
              ORDER BY ordinal_position;`,
    }),
  });

  const columns = await res.json();
  const hasFbaShippingFee = columns?.some?.((c: any) => c.column_name === "fba_shipping_fee");

  return NextResponse.json({
    migrations: {
      "006_add_fba_shipping_fee": hasFbaShippingFee ? "✅ 適用済み" : "❌ 未適用",
    },
    columns: columns || [],
  });
}
