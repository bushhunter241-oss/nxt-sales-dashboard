# Claude Code 実装指示: 親ASINを売上・広告集計から除外する

## 問題

Amazon SP-APIから売上・広告データを取得する際、親ASIN（バリエーションファミリーの箱）のデータも取り込まれている。子ASINの売上と親ASINの売上が二重カウントされ、利益計算がおかしくなっている。

例: 「imin お得用」(B0GMF8JBB4) が親ASINで、子バリエーション 50g/100g/30g の売上と二重に集計されている。さらに親ASINの原価が¥0なのに広告費 ¥46,220 が紐付いており、-166.6% の利益率になっている。

親ASINは子ASINのバリエーション管理に必要なので、`products` テーブルから削除・アーカイブはできない。

## やること

`products` テーブルに `is_parent` フラグを追加し、集計クエリで親ASINを除外する。

---

## ステップ1: Supabase にカラム追加

Supabase の SQL Editor で以下を実行:

```sql
-- products テーブルに is_parent フラグを追加
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_parent BOOLEAN DEFAULT false;

-- 既知の親ASINにフラグを設定
UPDATE products SET is_parent = true WHERE asin = 'B0GMF8JBB4';

-- 他にも親ASINがあれば同様に設定
-- UPDATE products SET is_parent = true WHERE asin = '親ASINの値';
```

---

## ステップ2: TypeScript の型定義を更新

`src/types/database.ts` の `Product` 型に `is_parent` を追加:

```typescript
// Product 型に追加
is_parent?: boolean;
```

---

## ステップ3: getProductSalesSummary() で親ASINを除外

`src/lib/api/sales.ts` の `getProductSalesSummary()` 関数を修正:

```typescript
// 変更前（70行目あたり）
let query = supabase
  .from("daily_sales")
  .select("product_id, sessions, orders, sales_amount, units_sold, product:products(*)");

// 変更後 — 親ASINの商品を除外するフィルタを追加
// daily_sales にはフィルタがかけられないので、取得後にフィルタリングする
```

具体的には、`getProductSalesSummary()` の return 手前で親商品を除外:

```typescript
// 4. Calculate profit for each product の後、return の前にフィルタ追加
return Object.values(grouped)
  .map((item: any) => {
    // ... 既存の利益計算ロジック ...
  })
  .filter((item: any) => !item.product?.is_parent); // ← この行を追加
```

---

## ステップ4: 広告費集計でも親ASINを除外

同じく `src/lib/api/sales.ts` の `getProductSalesSummary()` 内、広告費集計部分:

```typescript
// 広告費の集計部分（88-96行目あたり）で、親商品のproduct_idを除外
// まず親商品のIDリストを取得
const { data: parentProducts } = await supabase
  .from("products")
  .select("id")
  .eq("is_parent", true);

const parentIds = new Set((parentProducts || []).map((p: any) => p.id));

// 広告費集計で親を除外
const adByProduct: Record<string, { ad_spend: number; ad_sales: number }> = {};
for (const row of adData || []) {
  if (parentIds.has(row.product_id)) continue; // ← 親ASINスキップ
  if (!adByProduct[row.product_id]) {
    adByProduct[row.product_id] = { ad_spend: 0, ad_sales: 0 };
  }
  adByProduct[row.product_id].ad_spend += row.ad_spend;
  adByProduct[row.product_id].ad_sales += row.ad_sales;
}
```

---

## ステップ5: SP-API同期でも親ASINの売上を除外

`src/lib/sync/ads-api-sync.ts` の `processAdsReportData()` で、親ASINの広告データを取り込まないようにする:

```typescript
// asinToProductId マップ作成後（48行目あたり）に追加
const { data: parentProducts } = await supabase
  .from("products")
  .select("asin")
  .eq("is_parent", true);

const parentAsins = new Set((parentProducts || []).map((p: any) => p.asin));

// aggregateMap ループ内（59行目あたり）に追加
for (const row of reportData) {
  if (!row.advertisedAsin || !row.date) continue;
  if (parentAsins.has(row.advertisedAsin)) continue; // ← 親ASINスキップ
  // ... 残りの処理
}
```

同様に、SP-API売上同期（`src/lib/sync/sp-api-sync.ts`）にも親ASINスキップのロジックがあれば追加する。

---

## ステップ6: 商品マスタ管理画面に is_parent 表示を追加（任意）

商品マスタ管理画面で親商品を視覚的に区別できるようにする:
- 親商品の行に「親」バッジを表示
- 親フラグのON/OFFトグルを追加

---

## 完了後の確認

1. `npm run build` がエラーなく通ること
2. ダッシュボードの「imin お得用シリーズ」から親ASIN「imin お得用 (Amazon)」が消えていること
3. グループの商品数が13件→12件に減ること
4. 広告費 ¥185,855 から ¥46,220 が減り、¥139,635 になること
5. 純利益が ¥79,603 + ¥30,606 = 約¥110,000 前後に改善すること
6. 他にも親ASINが存在する場合、同様に `is_parent = true` を設定すること
