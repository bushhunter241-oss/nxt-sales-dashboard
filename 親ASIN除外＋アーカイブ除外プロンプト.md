# Claude Code 実装指示: 親ASIN除外 + アーカイブ商品除外

## 問題（3つ）

### 問題1: 親ASINが子バリエーションと二重カウントされている
Amazon SP-APIで親ASIN（バリエーションの箱）のデータも取り込まれ、子ASINの売上と二重に集計されている。親ASINは原価¥0なので利益計算もおかしい。

該当する親ASIN（4件）:
- `B0GMF8JBB4` — imin お得用（imin お得用シリーズ）
- `B0FKGL6HB` — imin Moon（imin Moonシリーズ）※ASINは要確認
- `B0FKZXVLV4` — imin 浄化香（imin お香シリーズ）
- `B0BJPJ5Z23` — feela.整体エルゴクッション（feela）

親ASINは子ASINの管理に必要なので削除・アーカイブ不可。

### 問題2: アーカイブ済み商品が集計に含まれている
`is_archived = true` の商品の `daily_sales` データが集計対象になっている。`getProductSalesSummary()` で `products` テーブルの `is_archived` をフィルタしていない。

### 問題3: 商品分析ページでアーカイブ商品がグループとして表示される
Amazon商品分析ページ（`products-analysis/page.tsx`）でもアーカイブ商品のグループが表示されてしまう。

---

## ステップ1: Supabase にカラム追加 + 親ASIN設定

Supabase SQL Editor で実行:

```sql
-- products テーブルに is_parent フラグを追加
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_parent BOOLEAN DEFAULT false;

-- 親ASINにフラグを設定
UPDATE products SET is_parent = true WHERE asin IN (
  'B0GMF8JBB4',  -- imin お得用
  'B0FKGL6HB',   -- imin Moon（ASINは要確認、商品マスタ管理画面のASIN列で確認）
  'B0FKZXVLV4',  -- imin 浄化香
  'B0BJPJ5Z23'   -- feela.整体エルゴクッション
);

-- 確認
SELECT name, asin, is_parent, is_archived FROM products WHERE is_parent = true;
```

**注意**: imin Moon の ASIN `B0FKGL6HB` は商品マスタ管理画面のスクリーンショットから読み取った値。正確な値を商品マスタ管理画面で確認すること。

---

## ステップ2: TypeScript の型定義を更新

`src/types/database.ts` の `Product` 型に追加:

```typescript
is_parent?: boolean;
```

---

## ステップ3: getProductSalesSummary() を修正（親ASIN除外 + アーカイブ除外）

`src/lib/api/sales.ts` の `getProductSalesSummary()` を修正。

### 3-1. 売上データ取得後に親ASIN・アーカイブ商品を除外

```typescript
// 現在のコード（98-115行目あたり）の grouped 作成後、
// Object.values(grouped) を return する前にフィルタを追加

return Object.values(grouped)
  .map((item: any) => {
    // ... 既存の利益計算ロジック（変更なし）...
  })
  .filter((item: any) => {
    const product = item.product;
    if (!product) return false;
    if (product.is_parent) return false;      // 親ASINを除外
    if (product.is_archived) return false;    // アーカイブ商品を除外
    return true;
  });
```

### 3-2. 広告費集計でも親ASINを除外

```typescript
// 広告費の集計部分（88-96行目あたり）を修正

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

## ステップ4: getRakutenProductSalesSummary() でもアーカイブ除外

`src/lib/api/rakuten-sales.ts` の `getRakutenProductSalesSummary()` の return にもフィルタを追加:

```typescript
return Object.values(grouped)
  .map((item: any) => {
    // ... 既存の利益計算ロジック（変更なし）...
  })
  .filter((item: any) => {
    const product = item.product;
    if (!product) return false;
    if (product.is_archived) return false;    // アーカイブ商品を除外
    return true;
  });
```

---

## ステップ5: 商品分析ページでもアーカイブ除外

### Amazon商品分析: `src/app/(dashboard)/products-analysis/page.tsx`

商品データをグループ化する前にアーカイブ商品を除外するフィルタを追加:

```typescript
// productSummary を使う箇所で、グループ化前にフィルタ
const activeProducts = (productSummary as any[]).filter(
  (p: any) => !p.product?.is_archived && !p.product?.is_parent
);
// この activeProducts を groupProducts() に渡す
```

### 楽天商品分析: `src/app/(dashboard)/rakuten/products/page.tsx`

同様に:

```typescript
const activeProducts = (productSummary as any[]).filter(
  (p: any) => !p.product?.is_archived
);
```

---

## ステップ6: SP-API同期で親ASINの広告データを取り込まない

`src/lib/sync/ads-api-sync.ts` の `processAdsReportData()`:

```typescript
// asinToProductId マップ作成後（48行目あたり）に追加
const { data: parentProductsList } = await supabase
  .from("products")
  .select("asin")
  .eq("is_parent", true);

const parentAsins = new Set(
  (parentProductsList || []).map((p: any) => p.asin).filter(Boolean)
);

// aggregateMap ループ内（59行目あたり）で親ASINをスキップ
for (const row of reportData) {
  if (!row.advertisedAsin || !row.date) continue;
  if (parentAsins.has(row.advertisedAsin)) continue; // ← 追加
  // ... 残りの処理はそのまま
}
```

---

## ステップ7: 商品マスタ管理画面に「親」バッジを表示（任意）

商品マスタ管理画面で親商品を視覚的に区別できるように:
- 商品名の横に「親」バッジ（灰色）を表示
- `is_parent` のON/OFFトグルを編集フォームに追加

---

## 完了後の確認

1. `npm run build` がエラーなく通ること
2. ダッシュボードの商品グループ別テーブルから以下が消えていること:
   - 親ASIN商品（imin お得用 Amazon、imin Moon Amazon、imin 浄化香 Amazon、feela.整体エルゴクッション Amazon）
   - アーカイブ済み商品（feela ドイツが愛した低反発、imin ホワイトセージ野生、Switch Joy-con）
3. Amazon商品分析ページからもアーカイブ商品のグループが消えていること
4. 各グループの利益率が改善していること（特にお得用シリーズ）
5. 合計の売上・利益が二重カウント分だけ減っていること
