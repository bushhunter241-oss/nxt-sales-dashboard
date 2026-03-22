-- Migration 013: Product groups master table
CREATE TABLE IF NOT EXISTS product_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Allow all operations for anon key (single-user dashboard)
ALTER TABLE product_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for product_groups" ON product_groups FOR ALL USING (true) WITH CHECK (true);

-- Seed existing groups from both Amazon and Rakuten products
INSERT INTO product_groups (name)
SELECT DISTINCT product_group FROM products WHERE product_group IS NOT NULL AND product_group != ''
ON CONFLICT (name) DO NOTHING;

INSERT INTO product_groups (name)
SELECT DISTINCT product_group FROM rakuten_products WHERE product_group IS NOT NULL AND product_group != ''
ON CONFLICT (name) DO NOTHING;
