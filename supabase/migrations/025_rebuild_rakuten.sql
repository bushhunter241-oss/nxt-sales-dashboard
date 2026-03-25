-- 楽天売上管理 ゼロベース再構築
-- SKU別原価管理テーブル + SKU別日次売上テーブル + 広告UNIQUE制約

-- 1. SKU別原価管理テーブル
CREATE TABLE IF NOT EXISTS rakuten_sku_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manage_number TEXT NOT NULL,
  sku_id TEXT NOT NULL,
  sku_label TEXT,
  cost_price NUMERIC NOT NULL DEFAULT 0,
  shipping_fee NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(manage_number, sku_id)
);

ALTER TABLE rakuten_sku_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on rakuten_sku_costs" ON rakuten_sku_costs FOR ALL USING (true);

-- 2. SKU別日次売上テーブル（利益計算の原価按分に使用）
CREATE TABLE IF NOT EXISTS rakuten_daily_sku_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manage_number TEXT NOT NULL,
  sku_id TEXT,
  date DATE NOT NULL,
  orders INTEGER NOT NULL DEFAULT 0,
  units_sold INTEGER NOT NULL DEFAULT 0,
  sales_amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(manage_number, COALESCE(sku_id, ''), date)
);

ALTER TABLE rakuten_daily_sku_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on rakuten_daily_sku_sales" ON rakuten_daily_sku_sales FOR ALL USING (true);

CREATE INDEX IF NOT EXISTS idx_rakuten_daily_sku_sales_date ON rakuten_daily_sku_sales(date);
CREATE INDEX IF NOT EXISTS idx_rakuten_daily_sku_sales_manage ON rakuten_daily_sku_sales(manage_number);

-- 3. rakuten_daily_advertising に UNIQUE制約追加（既存テーブル）
-- 重複を先に削除（最新のレコードを残す）
DELETE FROM rakuten_daily_advertising a
USING rakuten_daily_advertising b
WHERE a.product_id = b.product_id
  AND a.date = b.date
  AND a.id < b.id;

ALTER TABLE rakuten_daily_advertising
  ADD CONSTRAINT IF NOT EXISTS rakuten_daily_advertising_product_date_unique
  UNIQUE (product_id, date);
