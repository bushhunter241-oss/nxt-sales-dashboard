-- ============================================
-- Migration 005: 親ASINカラム追加
-- productsテーブルにparent_asinを追加
-- bsr_rankingsテーブルにproduct_groupを追加
-- ============================================

-- 1. productsテーブルにparent_asinカラムを追加
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'parent_asin'
  ) THEN
    ALTER TABLE products ADD COLUMN parent_asin TEXT;
    COMMENT ON COLUMN products.parent_asin IS 'Amazonバリエーション親ASIN（商品グループのBSR取得に使用）';
  END IF;
END $$;

-- 2. bsr_rankingsテーブルにproduct_groupカラムを追加（テーブルが存在する場合）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'bsr_rankings'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'bsr_rankings' AND column_name = 'product_group'
    ) THEN
      ALTER TABLE bsr_rankings ADD COLUMN product_group TEXT;
      COMMENT ON COLUMN bsr_rankings.product_group IS '商品グループ名（バリエーションをまとめた単位）';
    END IF;
  END IF;
END $$;

-- 3. インデックス追加
CREATE INDEX IF NOT EXISTS idx_products_parent_asin ON products(parent_asin) WHERE parent_asin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_product_group ON products(product_group) WHERE product_group IS NOT NULL;
