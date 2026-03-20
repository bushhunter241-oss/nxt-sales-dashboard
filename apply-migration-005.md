# タスク: Supabase Migration 005 を適用する

## 目的
`products` テーブルに `parent_asin` カラムを追加し、`bsr_rankings` テーブルに `product_group` カラムを追加する。

## Supabase 接続情報
- URL: `https://xohafbyqdsmcahovbdhi.supabase.co`
- Anon Key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvaGFmYnlxZHNtY2Fob3ZiZGhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NjU2NzAsImV4cCI6MjA4ODE0MTY3MH0.GtunG9JlJdPanvzwx-FEST8UKxY2hMKtkoGzAPvVupM`

## 実行するSQL

以下のSQLをSupabaseのREST API（`/rest/v1/rpc` または SQL Editor経由）で実行すること。

```sql
-- 1. productsテーブルにparent_asinカラムを追加
ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_asin TEXT;

-- 2. bsr_rankingsテーブルにproduct_groupカラムを追加（テーブルが存在する場合）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'bsr_rankings'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'bsr_rankings' AND column_name = 'product_group'
    ) THEN
      ALTER TABLE bsr_rankings ADD COLUMN product_group TEXT;
    END IF;
  END IF;
END $$;

-- 3. インデックス追加
CREATE INDEX IF NOT EXISTS idx_products_parent_asin ON products(parent_asin) WHERE parent_asin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_product_group ON products(product_group) WHERE product_group IS NOT NULL;
```

## 実行方法

Supabase Management APIを使ってSQLを実行する:

```
POST https://xohafbyqdsmcahovbdhi.supabase.co/rest/v1/rpc/exec_sql
```

または、Chromeで以下のURLを開いてSQL Editorから実行する:
```
https://supabase.com/dashboard/project/xohafbyqdsmcahovbdhi/sql/new
```

## 完了確認

以下のSQLで追加されたことを確認:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'parent_asin';
```

`parent_asin` が `text` 型で返ってきたら成功。
