-- Migration 021: Add Shopify and Meta Ads tables

-- Shopify売上データ（日次・注文明細）
CREATE TABLE IF NOT EXISTS shopify_daily_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  order_id TEXT,
  product_id UUID REFERENCES products(id),
  product_title TEXT,
  variant_title TEXT,
  sku TEXT,
  quantity INTEGER DEFAULT 0,
  gross_sales NUMERIC DEFAULT 0,
  discounts NUMERIC DEFAULT 0,
  net_sales NUMERIC DEFAULT 0,
  shipping NUMERIC DEFAULT 0,
  taxes NUMERIC DEFAULT 0,
  total_sales NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, order_id, sku)
);

-- Shopify日次サマリー
CREATE TABLE IF NOT EXISTS shopify_daily_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  total_orders INTEGER DEFAULT 0,
  total_units INTEGER DEFAULT 0,
  gross_sales NUMERIC DEFAULT 0,
  total_discounts NUMERIC DEFAULT 0,
  net_sales NUMERIC DEFAULT 0,
  sessions INTEGER DEFAULT 0,
  conversion_rate NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Meta広告データ（日次）
CREATE TABLE IF NOT EXISTS meta_ad_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  campaign_name TEXT,
  ad_set_name TEXT,
  ad_name TEXT,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  spend NUMERIC DEFAULT 0,
  purchases INTEGER DEFAULT 0,
  purchase_value NUMERIC DEFAULT 0,
  cpm NUMERIC DEFAULT 0,
  cpc NUMERIC DEFAULT 0,
  ctr NUMERIC DEFAULT 0,
  roas NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, campaign_name, ad_set_name, ad_name)
);

-- 商品マスタにShopify決済手数料率を追加
ALTER TABLE products ADD COLUMN IF NOT EXISTS commission_rate NUMERIC DEFAULT 0;
COMMENT ON COLUMN products.commission_rate IS 'Shopify決済手数料率(%)。通常3.4-3.55%。';

-- RLS
ALTER TABLE shopify_daily_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_daily_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_ad_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on shopify_daily_sales" ON shopify_daily_sales FOR ALL USING (true);
CREATE POLICY "Allow all on shopify_daily_summary" ON shopify_daily_summary FOR ALL USING (true);
CREATE POLICY "Allow all on meta_ad_daily" ON meta_ad_daily FOR ALL USING (true);

-- goalsテーブルのchannel制約を更新（shopify追加）
-- NOTE: 既存データとの互換性のためCHECK制約は追加しない（TEXT列で自由値を許容）
