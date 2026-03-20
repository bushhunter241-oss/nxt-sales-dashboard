/**
 * apply-migration.ts
 * Supabaseに未適用のマイグレーションを適用するスクリプト
 *
 * 使い方:
 *   npx ts-node --project tsconfig.json scripts/apply-migration.ts
 *
 * または環境変数を指定:
 *   SUPABASE_SERVICE_ROLE_KEY=xxx npx ts-node scripts/apply-migration.ts
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xohafbyqdsmcahovbdhi.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error("❌ SUPABASE_SERVICE_ROLE_KEY が設定されていません");
  console.error("   Vercel環境変数またはローカルの .env.local に設定してください");
  process.exit(1);
}

async function checkMigration(): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/products?select=fba_shipping_fee&limit=1`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    }
  );
  if (res.ok) {
    console.log("✅ Migration 006 (fba_shipping_fee) は既に適用済みです");
    return true;
  }
  const err = await res.json();
  if (err?.message?.includes("column") || res.status === 400) {
    console.log("⏳ Migration 006 は未適用です。適用します...");
    return false;
  }
  throw new Error(`確認失敗: ${JSON.stringify(err)}`);
}

async function applyMigration(): Promise<void> {
  const sql = `
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS fba_shipping_fee INTEGER NOT NULL DEFAULT 0;

    COMMENT ON COLUMN products.fba_shipping_fee
      IS 'FBA配送手数料（1個あたりの固定額、単位：円）。Amazonが実際に請求するFBA送料。紹介料(fba_fee_rate)とは別。';
  `;

  // Supabase Management API経由でSQL実行
  const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) throw new Error("Supabase project refを取得できません");

  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ query: sql }),
  });

  if (res.ok) {
    console.log("✅ Migration 006 を正常に適用しました！");
    console.log("   products.fba_shipping_fee カラムが追加されました");
  } else {
    const err = await res.json();
    throw new Error(`Migration失敗: ${JSON.stringify(err)}`);
  }
}

(async () => {
  try {
    const alreadyApplied = await checkMigration();
    if (!alreadyApplied) {
      await applyMigration();
    }
  } catch (e) {
    console.error("❌ エラー:", e);
    process.exit(1);
  }
})();
