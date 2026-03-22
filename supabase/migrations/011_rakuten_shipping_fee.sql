-- Migration 011: Add shipping_fee to rakuten_products
ALTER TABLE rakuten_products
  ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC NOT NULL DEFAULT 0;

COMMENT ON COLUMN rakuten_products.shipping_fee IS '1個あたりの固定配送コスト（円）。楽天出荷時の送料。';
