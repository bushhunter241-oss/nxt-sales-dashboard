# NXT売上管理ダッシュボード — Claude Code 実装指示書

作成日: 2026-03-22
対象プロジェクト: `sales-dashboard/`（Next.js 15 + Supabase）

---

## 現在のシステム状態サマリ

| 機能 | 状態 |
|------|------|
| Amazon SP-API 自動同期（注文・在庫・トラフィック） | ✅ 完成・稼働中 |
| Amazon CSVインポート（ビジネスレポート・広告） | ✅ 完成（`/import`画面） |
| Amazon ページネーションバグ修正・バックフィル | ✅ 修正済み（1,235件保存済み） |
| 楽天 受注API同期 | ⚠️ **バグあり**（親商品に集約されてしまう） |
| 楽天 CSVインポート（アクセス・売上） | ✅ 完成（`/import`画面の「楽天アクセス・売上」タブ） |
| 楽天 RPP広告ページ | ⚠️ **改善必要**（TACoS列・Amazonデザイン化） |
| 楽天 子商品の原価フォールバック | ❌ **未実装** |

---

## 実装タスク一覧

---

## タスク1: 楽天 子商品（SKU）別売上の正しい紐付け修正

### 問題の詳細

`src/lib/rakuten/sync.ts` の `aggregateOrders()` 関数内で、商品IDの特定ロジックが以下の順で試みられている：

```typescript
const productId = sku?.merchantDefinedSkuId || sku?.variantId || item.itemNumber || item.manageNumber || item.itemId || "unknown";
```

- `manageNumber` は **親商品の商品管理番号** であるため、子商品（バリエーションSKU）の受注が親商品にまとめられてしまう
- 正しくは `merchantDefinedSkuId`（例: `feela01s`）を最優先で使うべきで、それがない場合のみ `manageNumber` にフォールバックする

### 修正対象ファイル

`src/lib/rakuten/sync.ts`

### 具体的な修正内容

**① `aggregateOrders()` の商品ID特定ロジックを修正する**

```typescript
// 修正前
const productId = sku?.merchantDefinedSkuId || sku?.variantId || item.itemNumber || item.manageNumber || item.itemId || "unknown";

// 修正後: 子商品SKUを最優先。なければ親商品IDにフォールバック
const childSkuId = sku?.merchantDefinedSkuId || sku?.variantId;
const parentProductId = item.manageNumber || item.itemNumber || item.itemId;
const productId = childSkuId || parentProductId || "unknown";
// 親商品IDかどうかのフラグも保持する
const isChildSku = !!childSkuId;
```

**② `AggEntry` に `parent_product_id` と `is_child_sku` フィールドを追加する**

```typescript
interface AggEntry {
  product_id: string;       // 子商品SKU（merchantDefinedSkuId）
  parent_product_id: string | null; // 親商品管理番号（manageNumber）
  is_child_sku: boolean;
  product_name: string;
  sku: string | null;
  date: string;
  orders: number;
  units_sold: number;
  sales_amount: number;
}
```

**③ `upsertProducts()` で子商品を `rakuten_products` に登録する際、`parent_product_id` を正しくセットする**

- `is_child_sku = true` の場合: `parent_product_id` = `parentProductId`
- 子商品の `sku` フィールドに `productId`（merchantDefinedSkuId等）をセット
- `product_id`（商品管理番号）は `parentProductId` をセット（楽天の商品管理番号は親単位）
- ただし `sku` フィールドを使って子商品を区別する

**④ `upsertDailySales()` で子商品SKUを優先して `rakuten_products` テーブルから検索する**

```typescript
// SKUフィールドで子商品を検索し、なければ product_id（親商品番号）で検索
const rktProduct = skuMap.get(entry.product_id) || productIdMap.get(entry.product_id);
```

### データベースマイグレーション（必要な場合）

`rakuten_products` テーブルに `sku` フィールドが存在するか確認する。
存在しない場合は以下のマイグレーションを追加する：

```sql
-- supabase/migrations/014_rakuten_sku_field.sql
ALTER TABLE rakuten_products ADD COLUMN IF NOT EXISTS sku TEXT;
CREATE INDEX IF NOT EXISTS idx_rakuten_products_sku ON rakuten_products(sku);
```

---

## タスク2: 楽天 子商品の原価・送料フォールバック処理

### 問題の詳細

楽天の子商品（バリエーション）は原価（`cost_price`）や送料（`shipping_fee`）が未設定（0）の場合が多い。
利益計算時にこれらが0のままだと、利益率が誤って100%になってしまう。

### 修正対象ファイル

- `src/lib/api/rakuten-sales.ts` — 利益計算ロジック
- `src/app/(dashboard)/rakuten/products/page.tsx` — 商品別利益表示

### 具体的な修正内容

**`rakuten-sales.ts` の利益計算関数内に親商品フォールバックを追加する**

```typescript
// 利益計算前に、cost_price=0 の子商品は親商品のcost_priceを使う
function getEffectiveCostPrice(product: RakutenProduct, parentProducts: Map<string, RakutenProduct>): number {
  if (product.cost_price > 0) return product.cost_price;
  if (product.parent_product_id) {
    const parent = parentProducts.get(product.parent_product_id);
    if (parent && parent.cost_price > 0) return parent.cost_price;
  }
  return 0;
}

function getEffectiveShippingFee(product: RakutenProduct, parentProducts: Map<string, RakutenProduct>): number {
  if (product.shipping_fee > 0) return product.shipping_fee;
  if (product.parent_product_id) {
    const parent = parentProducts.get(product.parent_product_id);
    if (parent && parent.shipping_fee > 0) return parent.shipping_fee;
  }
  return 0;
}
```

**データ取得時に親商品もまとめて取得する**

```typescript
// rakuten_products を取得する際、is_archived=false の全商品を取得し
// parent_product_id でマップを作成しておく
const { data: allProducts } = await supabase
  .from("rakuten_products")
  .select("*")
  .eq("is_archived", false);

const parentProductMap = new Map<string, RakutenProduct>(
  (allProducts || [])
    .filter(p => !p.parent_product_id) // 親商品のみ
    .map(p => [p.product_id, p])
);
```

---

## タスク3: 楽天 過去データのクリーンアップと再同期

### 目的

過去に誤って「親商品」のIDで保存されてしまった `rakuten_daily_sales` レコードを削除し、子商品SKU単位で正しく再同期する。

### 実装方法

**① 管理者用APIエンドポイントを追加する**

ファイル: `src/app/api/admin/cleanup-rakuten-parent-sales/route.ts`

```typescript
// POST /api/admin/cleanup-rakuten-parent-sales
// Body: { dateFrom: "2025-01-01", dateTo: "2025-03-31", dryRun: true }
// 処理:
// 1. rakuten_products から「parent_product_id が NULL（＝親商品）」の商品IDリストを取得
// 2. rakuten_daily_sales から、上記の親商品に紐づくレコードを検索
// 3. dryRun=true なら削除件数のみ返す、false なら実際に削除する
```

**② 削除後、楽天受注APIを使って正しい期間を再同期する**

既存の `POST /api/rakuten/sync` エンドポイントに期間を指定して再実行する。

### UI（任意）

`src/app/(dashboard)/settings/api-integration/page.tsx` の楽天セクションに「過去データ再同期」ボタンを追加する。

---

## タスク4: 楽天 RPP広告ページをAmazon仕様化

### 問題の詳細

現在の `/rakuten/rpp` ページは商品グループ別集計まで実装されているが、以下が不足している：
- TACoS列（広告費 ÷ **総売上**）の表示
- Amazon版広告ページと同じテーブルレイアウト

### 修正対象ファイル

`src/app/(dashboard)/rakuten/rpp/page.tsx`

### 具体的な修正内容

**① 商品グループ別テーブルにTACoS列を追加する**

現在のコードでは `tacos` は KPIカードに全体集計として表示されているが、**商品グループ別テーブル**にも追加する。

商品グループ別のTACoSを計算するために、`getRakutenProductSalesSummary()` から総売上を取得し、グループ別に突合する。

```typescript
// groupAgg の計算時に totalSalesForGroup を持てるよう、
// productSummary（売上データ）の product_group と adData の group を突合する

const salesByGroup = (productSummary as any[]).reduce((acc: Record<string, number>, p: any) => {
  const group = p.product_group || p.name || "未分類";
  acc[group] = (acc[group] || 0) + p.total_sales;
  return acc;
}, {});

// groupAgg にも total_sales を追加
acc[group].total_sales = salesByGroup[group] || 0;

// TACoS計算
const tacos = group.total_sales > 0 ? (group.ad_spend / group.total_sales) * 100 : 0;
```

**② テーブルのカラム順をAmazon広告ページ（`/advertising`）と揃える**

`/advertising` ページのテーブルと同じ順・同じラベルにする：
- 商品グループ | 広告費 | 広告売上 | ACOS | ROAS | **TACoS** | クリック | インプレッション | CTR

**③ CTR（クリック率）列を追加する**

```typescript
const ctr = group.impressions > 0 ? (group.clicks / group.impressions) * 100 : 0;
```

**④ Amazon広告ページと同じスタイルのバッジ（ACOSの色分け）を適用する**

- ACOS < 20%: 緑バッジ
- ACOS 20〜40%: 黄バッジ
- ACOS > 40%: 赤バッジ

---

## タスク5: Amazon 過去データのCSV上書きインポート（運用手順）

### 状況

Amazon側のSP-APIデータとビジネスレポートCSVの乖離：

| 月 | ビジネスレポートCSV | ダッシュボード（SP-API） |
|----|-------------------|-----------------------|
| 1月 | 490万 | 304万 |
| 2月 | 393万 | 405万 |
| 3月 | 369万 | 368万 ✅ほぼ一致 |

3月は完璧に一致しているため、SP-APIの仕様で**60日以上前の過去データは正確に取得できない**ことが原因。

### 解決方法

**CSVインポート画面が既に完成している**ため、コードの修正は不要。
以下の運用手順をスタッフに共有する：

```
1. セラーセントラル → レポート → ビジネスレポート
   → 詳細ページ 売上・トラフィック（子ASIN別）
   → 対象月（例: 1月: 2025-01-01〜2025-01-31）を選択してCSVダウンロード

2. ダッシュボードの「CSVインポート」画面を開く

3. 「🟠 ビジネスレポート」タブを選択

4. ダウンロードしたCSVをドラッグ＆ドロップ

5. 「インポート実行」ボタンをクリック
   → 既存のSP-APIデータより正確なCSVデータで上書きされる（sourceが'csv'に更新）
```

### コード確認事項（念のため）

`src/lib/api/sales.ts` の `upsertDailySales()` 関数が、CSVインポート時に `source: 'csv'` を正しく上書きしているか確認する。
`source = 'csv'` のレコードが `source = 'sp-api'` より優先されるよう設計されているか確認し、されていなければ以下を追加する：

```typescript
// upsert時に source='csv' のデータは常に上書き優先
const { error } = await supabase
  .from("daily_sales")
  .upsert(record, {
    onConflict: "product_id,date",
    ignoreDuplicates: false, // 既存レコードを上書き
  });
```

---

## 実装優先順位

```
優先度HIGH  : タスク1（楽天SKU別バグ修正）→ データの正確性に直結
優先度HIGH  : タスク2（原価フォールバック）→ 利益計算の正確性
優先度MEDIUM: タスク3（過去データクリーンアップ）→ タスク1完了後に実施
優先度MEDIUM: タスク4（RPP広告Amazon化）→ 分析精度向上
優先度LOW   : タスク5（運用手順）→ コード変更なし、即実施可能
```

---

## テクニカル仕様

### スタック
- **フレームワーク**: Next.js 15 (App Router)
- **言語**: TypeScript（strict mode）
- **DB**: Supabase (PostgreSQL)
- **スタイル**: Tailwind CSS + shadcn/ui コンポーネント
- **状態管理**: TanStack Query（React Query）
- **CSVパース**: PapaParse

### 主要ファイル構成
```
src/
├── app/
│   ├── (dashboard)/
│   │   ├── import/page.tsx          ← CSVインポート画面（完成済み）
│   │   ├── rakuten/
│   │   │   ├── page.tsx             ← 楽天ダッシュボード
│   │   │   ├── products/page.tsx    ← 楽天商品別利益
│   │   │   ├── rpp/page.tsx         ← 楽天RPP広告（要改善）
│   │   │   └── daily/page.tsx       ← 楽天日別売上
│   │   └── advertising/page.tsx     ← Amazon広告（参考デザイン）
│   └── api/
│       ├── rakuten/sync/route.ts    ← 楽天同期API
│       └── sync/sp-api/route.ts    ← Amazon同期API
├── lib/
│   ├── rakuten/
│   │   ├── sync.ts                  ← ★タスク1・2の修正対象
│   │   └── orders.ts               ← 楽天受注API
│   ├── api/
│   │   ├── rakuten-sales.ts         ← ★タスク2の修正対象
│   │   └── sales.ts                ← Amazon売上API
│   └── sync/
│       └── sp-api-sync.ts          ← Amazon SP-API同期
└── types/database.ts               ← 型定義
```

### Supabase テーブル（楽天関連）

```
rakuten_products
  - id (UUID, PK)
  - product_id (TEXT) ← 商品管理番号（楽天の親商品番号）
  - sku (TEXT, nullable) ← 子商品SKU（merchantDefinedSkuId）★タスク1で追加
  - name (TEXT)
  - cost_price (NUMERIC)
  - shipping_fee (NUMERIC)
  - fee_rate (NUMERIC) ← 楽天手数料率
  - parent_product_id (TEXT, nullable) ← 親商品管理番号
  - product_group (TEXT, nullable)

rakuten_daily_sales
  - id (UUID, PK)
  - product_id (UUID, FK → rakuten_products.id)
  - date (DATE)
  - access_count (INT)
  - orders (INT)
  - sales_amount (NUMERIC)
  - units_sold (INT)
  - cvr (NUMERIC)
  - source ('csv' | 'api')

rakuten_daily_advertising
  - id (UUID, PK)
  - product_id (UUID, FK → rakuten_products.id)
  - date (DATE)
  - ad_spend (NUMERIC)
  - ad_sales (NUMERIC)
  - impressions (INT)
  - clicks (INT)
  - acos (NUMERIC)
  - roas (NUMERIC)
  - campaign_name (TEXT, nullable)
  - campaign_type (TEXT) ← 'RPP' etc.
```

---

## 各タスクの実装完了確認チェックリスト

### タスク1完了条件
- [ ] `aggregateOrders()` が `merchantDefinedSkuId` を最優先で使用する
- [ ] `feela01s` 等の子商品SKUが `rakuten_products.sku` に保存される
- [ ] 楽天API同期後、`rakuten_daily_sales` が子商品単位で集計される
- [ ] 親商品に集約されるバグが発生しない

### タスク2完了条件
- [ ] `cost_price = 0` の子商品が親商品の原価を使って利益計算される
- [ ] `shipping_fee = 0` の子商品が親商品の送料を使って利益計算される
- [ ] 商品別利益ページで利益率が正しく表示される

### タスク3完了条件
- [ ] 管理者APIが親商品に紐づいた誤ったレコードを特定できる
- [ ] `dryRun=true` で削除対象件数を確認できる
- [ ] `dryRun=false` で削除→再同期が正常に完了する

### タスク4完了条件
- [ ] RPPページの商品グループ別テーブルにTACoS列が表示される
- [ ] CTR列が表示される
- [ ] ACOSに色分けバッジが表示される（緑/黄/赤）
- [ ] テーブル列順がAmazon広告ページと一致する

### タスク5完了条件
- [ ] CSVインポートで上書きされた売上データが `source = 'csv'` になっている
- [ ] 1月・2月のダッシュボード売上がビジネスレポートCSVと一致する
