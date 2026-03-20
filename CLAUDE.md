# NXT売上管理ダッシュボード - Claude Code 指示書

---

## ⚠️ 未適用マイグレーション（最初にこれを実行すること）

このプロジェクトでコードを修正する前に、以下のマイグレーションがSupabaseに適用されているか確認し、未適用であれば適用すること。

### 確認方法
```
https://nxt-sales-dashboard.vercel.app/api/debug?action=count-products
```
→ レスポンスに `fba_shipping_fee` キーが含まれていれば適用済み。含まれていなければ未適用。

### 適用方法（Supabase SQL Editor）
以下のSQLをSupabase SQL Editorで実行する:
```sql
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS fba_shipping_fee INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN products.fba_shipping_fee IS 'FBA配送手数料（1個あたりの固定額、単位：円）。Amazonが実際に請求するFBA送料。紹介料(fba_fee_rate)とは別。';
```
SQL Editor URL: https://supabase.com/dashboard/project/xohafbyqdsmcahovbdhi/sql/new

### 確認SQL
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'fba_shipping_fee';
```
→ 1行返れば適用済み。0行なら未適用。

### Claude Codeからの自動適用方法（SUPABASE_SERVICE_ROLE_KEYがVercelに設定済みの場合）
```bash
curl -X POST https://nxt-sales-dashboard.vercel.app/api/admin/migrate \
  -H "Content-Type: application/json" \
  -d '{"migration": "006_add_fba_shipping_fee"}'
```

### 適用状況の確認API
```bash
curl https://nxt-sales-dashboard.vercel.app/api/admin/migrate
```

---

## プロジェクト概要

Amazon（日本）の売上・利益を管理するNext.js 15ダッシュボード。
Supabase（PostgreSQL）をバックエンドとして使用し、Vercelにデプロイ済み。

- **本番URL**: https://nxt-sales-dashboard.vercel.app
- **Supabase Project**: xohafbyqdsmcahovbdhi
- **マーケットプレイス**: Amazon.co.jp（A1VC38T7YXB528）

---

## 技術スタック

- **フレームワーク**: Next.js 15 (App Router)
- **言語**: TypeScript (strict mode)
- **スタイリング**: Tailwind CSS (ダークテーマ)
- **DB**: Supabase (PostgreSQL + PostgREST)
- **状態管理**: TanStack Query (React Query)
- **チャート**: Recharts
- **デプロイ**: Vercel

---

## ディレクトリ構造

```
src/
├── app/
│   ├── (dashboard)/          # ダッシュボードページ群
│   │   ├── daily/            # 日次売上
│   │   ├── monthly/          # 月次売上
│   │   ├── products-analysis/ # 商品別分析（純利益計算）
│   │   ├── advertising/      # 広告分析
│   │   ├── inventory/        # 在庫管理
│   │   ├── simulation/       # 利益シミュレーション
│   │   ├── goals/            # 月次目標
│   │   ├── import/           # CSVインポート
│   │   ├── settings/
│   │   │   ├── products/     # 商品マスタ（原価・FBA手数料設定）
│   │   │   └── expenses/     # 経費設定
│   │   └── rakuten/          # 楽天市場ページ群
│   └── api/
│       ├── sync/
│       │   ├── sp-api/       # SP-API同期（注文・在庫・トラフィック）
│       │   ├── ads-api/      # 広告API同期
│       │   ├── fba-fees/     # FBA送料自動取得（Finances API）
│       │   └── status/       # 同期ステータス
│       └── credentials/      # API認証情報管理
├── components/
│   ├── ui/                   # 共通UIコンポーネント
│   ├── layout/               # レイアウト（サイドバー・ヘッダー）
│   └── charts/               # チャートコンポーネント
├── lib/
│   ├── amazon/
│   │   ├── sp-api.ts         # SP-API クライアント（Orders/Inventory/Reports/Finances）
│   │   ├── ads-api.ts        # Ads API クライアント
│   │   ├── auth.ts           # LWA認証（アクセストークン更新）
│   │   └── config.ts         # API設定（エンドポイント・レート制限）
│   ├── api/
│   │   ├── sales.ts          # 売上データ取得・利益計算
│   │   └── products.ts       # 商品マスタCRUD
│   └── sync/
│       ├── sp-api-sync.ts    # SP-API同期ロジック
│       └── ads-api-sync.ts   # 広告API同期ロジック
└── types/
    └── database.ts           # Supabaseテーブルの型定義
```

---

## 利益計算のロジック（重要）

`src/lib/api/sales.ts` の `getProductSalesSummary()` で計算。

```
純利益 = 売上 - 原価 - 紹介料 - FBA配送手数料 - 広告費

- 売上 (total_sales)      = daily_sales.sales_amount の合計
- 原価 (total_cost)       = products.cost_price × 販売数量
- 紹介料 (total_referral_fee) = 売上 × products.fba_fee_rate / 100  ← Amazonへの紹介料（%）
- FBA配送手数料 (total_shipping_fee) = products.fba_shipping_fee × 販売数量  ← 固定額（円/個）
- 広告費 (total_ad_spend) = daily_advertising.ad_spend の合計
```

### productsテーブルの費用関連カラム

| カラム | 説明 | 例 |
|--------|------|-----|
| `cost_price` | 仕入原価（円） | 3100 |
| `fba_fee_rate` | Amazon紹介料率（%） | 15.0 |
| `fba_shipping_fee` | FBA配送手数料（円/個） | 532 |

---

## Supabaseスキーマ（主要テーブル）

### products
```sql
id UUID, name TEXT, code TEXT, asin TEXT, sku TEXT,
selling_price INTEGER, cost_price INTEGER,
fba_fee_rate NUMERIC(5,2),     -- 紹介料率(%)
fba_shipping_fee INTEGER,      -- FBA配送手数料(円/個) ← Migration 006で追加
product_group TEXT, parent_asin TEXT, is_archived BOOLEAN
```

### daily_sales
```sql
id UUID, product_id UUID, date DATE,
sessions INTEGER, orders INTEGER, sales_amount INTEGER,
units_sold INTEGER, cvr NUMERIC, cancellations INTEGER,
source TEXT  -- 'csv' | 'sp-api' | 'csv-reimport'
```

### daily_advertising
```sql
id UUID, product_id UUID, date DATE,
ad_spend INTEGER, ad_sales INTEGER, impressions INTEGER,
clicks INTEGER, acos NUMERIC, roas NUMERIC,
campaign_name TEXT, campaign_type TEXT
```

---

## SP-API 統合

### 認証
- `src/lib/amazon/auth.ts`: LWA（Login with Amazon）でアクセストークンを取得
- 認証情報は Supabase の `api_credentials` テーブルに暗号化して保存
- APIキー: `SUPABASE_SERVICE_ROLE_KEY` は Vercel 環境変数に設定

### SP-API エンドポイント（日本）
- **SP-API**: `https://sellingpartnerapi-fe.amazon.com`
- **LWA**: `https://api.amazon.co.jp/auth/o2/token`
- **Marketplace ID**: `A1VC38T7YXB528`

### 実装済みAPI
| ファイル | 機能 |
|----------|------|
| `sp-api.ts: getOrders()` | 注文一覧取得（Orders API） |
| `sp-api.ts: getOrderItems()` | 注文明細取得 |
| `sp-api.ts: getFbaInventory()` | FBA在庫取得 |
| `sp-api.ts: downloadSalesTrafficReport()` | 売上・トラフィックレポート（Reports API） |
| `sp-api.ts: getActualFbaFees()` | 実際のFBA配送手数料取得（Finances API） |
| `sp-api.ts: getCatalogItemBSR()` | BSRランキング取得 |

### FBA送料の自動更新
`POST /api/sync/fba-fees` に以下のJSONを送信：
```json
{ "startDate": "2026-01-01", "endDate": "2026-03-20" }
```
→ Finances APIから実際のFBA送料を取得し、`products.fba_shipping_fee` を自動更新

---

## よくある作業パターン

### 新しいAPIエンドポイントを追加する場合
1. `src/lib/amazon/sp-api.ts` にAPI関数を追加
2. `src/lib/sync/sp-api-sync.ts` に同期ロジックを追加
3. `src/app/api/sync/[機能名]/route.ts` にAPIルートを作成
4. 必要に応じて `src/types/database.ts` を更新

### 新しいSupabaseカラムを追加する場合
1. `supabase/migrations/00X_description.sql` でマイグレーションを作成
2. `src/types/database.ts` の対応インターフェースを更新
3. SQL EditorでマイグレーションSQLを実行: https://supabase.com/dashboard/project/xohafbyqdsmcahovbdhi/sql/new
4. 関連するAPI・UIコンポーネントを更新

### 利益計算を変更する場合
- **必ず** `src/lib/api/sales.ts` の `getProductSalesSummary()` を修正
- Google スプレッドシート「amazon商品別売上」の計算式と照合して整合性を確認

---

## 環境変数（.env.local）

```
NEXT_PUBLIC_SUPABASE_URL=https://xohafbyqdsmcahovbdhi.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

Vercel本番環境には追加で：
```
SUPABASE_SERVICE_ROLE_KEY=...  # SP-API認証情報の暗号化に使用
```

---

## デプロイ

```bash
# ローカル開発
npm run dev

# ビルド確認
npm run build

# Vercelへのデプロイ（main ブランチへのプッシュで自動デプロイ）
git push origin main
```

---

## コーディング規約

- **型安全性**: TypeScriptのstrictモードを有効化。`any`の使用は最小限に
- **エラーハンドリング**: API呼び出しは必ずtry-catchで囲む
- **日時**: Amazon APIはUTC、表示はJST（UTC+9）に変換
- **金額**: 整数（円）で保存。小数点以下は`Math.round()`で丸める
- **ページング**: SP-APIのNextTokenを使ったページング処理を実装すること
- **レート制限**: SP-APIは保守的に3req/s、間に`sleep()`を挟む

---

## 注意事項

- SP-APIの認証情報（`refresh_token`, `client_secret`）はSupabaseのRLSで保護されている
- FBA配送手数料（`fba_shipping_fee`）とAmazon紹介料（`fba_fee_rate`）は**別物**。混同しないこと
- 日次データの日付はJST基準（`new Date().getTime() + 9*60*60*1000`）でバケットする
- Vercel無料プランの制約: サーバーレス関数の最大実行時間は60秒（`export const maxDuration = 60`）
