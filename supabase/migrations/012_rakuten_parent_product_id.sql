-- Migration 012: Add parent_product_id to rakuten_products for variation support
ALTER TABLE rakuten_products
  ADD COLUMN IF NOT EXISTS parent_product_id TEXT;

COMMENT ON COLUMN rakuten_products.parent_product_id IS '親商品の商品管理番号。NULLなら親商品、値があれば子商品（バリエーション）。';
