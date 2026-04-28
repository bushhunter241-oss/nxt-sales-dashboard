-- products テーブルに Shopify 専用の配送コストカラムを追加。
-- Amazon の fba_shipping_fee とは別管理（Shopify は自社/外部配送業者を使うため）。
-- shopify_shipping_fee が 0 の場合は fba_shipping_fee へフォールバックする
-- ロジックがアプリ側にある（src/lib/api/shopify-sales.ts, src/app/page.tsx 参照）。

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS shopify_shipping_fee INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN products.shopify_shipping_fee
  IS 'Shopify配送コスト（1個あたりの固定額、単位：円）。0の場合は fba_shipping_fee にフォールバック。';
