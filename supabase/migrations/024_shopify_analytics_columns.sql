-- shopify_daily_summary にアナリティクスカラムを追加
ALTER TABLE shopify_daily_summary
  ADD COLUMN IF NOT EXISTS visitors INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS add_to_cart INTEGER DEFAULT 0;

COMMENT ON COLUMN shopify_daily_summary.visitors IS '日別ユニーク訪問者数（Shopify Analytics）';
COMMENT ON COLUMN shopify_daily_summary.add_to_cart IS '日別カート追加回数（Shopify Analytics）';
