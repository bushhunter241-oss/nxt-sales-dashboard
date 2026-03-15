-- Amazon Sales Dashboard Schema

-- Products (商品マスタ)
CREATE TABLE products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  asin TEXT,
  sku TEXT,
  selling_price INTEGER NOT NULL DEFAULT 0,
  cost_price INTEGER NOT NULL DEFAULT 0,
  fba_fee_rate NUMERIC(5,2) NOT NULL DEFAULT 15.0,
  category TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Daily Sales (日別売上)
CREATE TABLE daily_sales (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  sessions INTEGER NOT NULL DEFAULT 0,
  orders INTEGER NOT NULL DEFAULT 0,
  sales_amount INTEGER NOT NULL DEFAULT 0,
  units_sold INTEGER NOT NULL DEFAULT 0,
  cvr NUMERIC(6,2) NOT NULL DEFAULT 0,
  cancellations INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, date)
);

-- Daily Advertising (日別広告)
CREATE TABLE daily_advertising (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  ad_spend INTEGER NOT NULL DEFAULT 0,
  ad_sales INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  acos NUMERIC(6,2) NOT NULL DEFAULT 0,
  roas NUMERIC(6,2) NOT NULL DEFAULT 0,
  campaign_name TEXT,
  campaign_type TEXT NOT NULL DEFAULT 'sp',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Expenses (経費)
CREATE TABLE expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  expense_type TEXT NOT NULL CHECK (expense_type IN ('fee', 'shipping', 'other')),
  amount INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inventory (在庫)
CREATE TABLE inventory (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE UNIQUE,
  current_stock INTEGER NOT NULL DEFAULT 0,
  reorder_point INTEGER NOT NULL DEFAULT 10,
  lead_days INTEGER NOT NULL DEFAULT 14,
  last_restocked_at TIMESTAMPTZ,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Inventory Logs (在庫変動履歴)
CREATE TABLE inventory_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  change_amount INTEGER NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('inbound', 'outbound', 'adjustment')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Monthly Goals (月間目標)
CREATE TABLE monthly_goals (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  year_month TEXT NOT NULL,
  target_sales INTEGER NOT NULL DEFAULT 0,
  target_orders INTEGER NOT NULL DEFAULT 0,
  target_profit INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, year_month)
);

-- Indexes
CREATE INDEX idx_daily_sales_date ON daily_sales(date);
CREATE INDEX idx_daily_sales_product ON daily_sales(product_id);
CREATE INDEX idx_daily_advertising_date ON daily_advertising(date);
CREATE INDEX idx_daily_advertising_product ON daily_advertising(product_id);
CREATE INDEX idx_expenses_date ON expenses(date);
CREATE INDEX idx_inventory_logs_product ON inventory_logs(product_id);
CREATE INDEX idx_monthly_goals_month ON monthly_goals(year_month);

-- Enable RLS (Row Level Security) - allow all for now (no auth)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_advertising ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_goals ENABLE ROW LEVEL SECURITY;

-- Policies (allow all - single user app)
CREATE POLICY "Allow all on products" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on daily_sales" ON daily_sales FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on daily_advertising" ON daily_advertising FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on expenses" ON expenses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on inventory" ON inventory FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on inventory_logs" ON inventory_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on monthly_goals" ON monthly_goals FOR ALL USING (true) WITH CHECK (true);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER inventory_updated_at BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION update_updated_at();
