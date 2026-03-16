-- 楽天API認証情報
CREATE TABLE IF NOT EXISTS rakuten_api_credentials (
  id TEXT PRIMARY KEY DEFAULT 'default',
  service_secret TEXT NOT NULL,
  license_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rakuten_api_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on rakuten_api_credentials" ON rakuten_api_credentials FOR ALL USING (true);

-- 楽天商品マスタ
CREATE TABLE IF NOT EXISTS rakuten_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  product_id TEXT NOT NULL UNIQUE,
  sku TEXT,
  selling_price NUMERIC NOT NULL DEFAULT 0,
  cost_price NUMERIC NOT NULL DEFAULT 0,
  fee_rate NUMERIC NOT NULL DEFAULT 10,
  category TEXT,
  product_group TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rakuten_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on rakuten_products" ON rakuten_products FOR ALL USING (true);

-- 楽天日別売上
CREATE TABLE IF NOT EXISTS rakuten_daily_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES rakuten_products(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  orders INTEGER NOT NULL DEFAULT 0,
  sales_amount NUMERIC NOT NULL DEFAULT 0,
  units_sold INTEGER NOT NULL DEFAULT 0,
  cvr NUMERIC NOT NULL DEFAULT 0,
  cancellations INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'csv',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, date)
);

ALTER TABLE rakuten_daily_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on rakuten_daily_sales" ON rakuten_daily_sales FOR ALL USING (true);

-- 楽天日別広告（RPP等）
CREATE TABLE IF NOT EXISTS rakuten_daily_advertising (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES rakuten_products(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  ad_spend NUMERIC NOT NULL DEFAULT 0,
  ad_sales NUMERIC NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  acos NUMERIC NOT NULL DEFAULT 0,
  roas NUMERIC NOT NULL DEFAULT 0,
  campaign_name TEXT,
  campaign_type TEXT NOT NULL DEFAULT 'RPP',
  source TEXT NOT NULL DEFAULT 'csv',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE rakuten_daily_advertising ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on rakuten_daily_advertising" ON rakuten_daily_advertising FOR ALL USING (true);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_rakuten_daily_sales_date ON rakuten_daily_sales(date);
CREATE INDEX IF NOT EXISTS idx_rakuten_daily_sales_product ON rakuten_daily_sales(product_id);
CREATE INDEX IF NOT EXISTS idx_rakuten_daily_advertising_date ON rakuten_daily_advertising(date);
CREATE INDEX IF NOT EXISTS idx_rakuten_daily_advertising_product ON rakuten_daily_advertising(product_id);
