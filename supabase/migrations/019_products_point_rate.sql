-- Migration 019: Add point_rate to products for Amazon point cost calculation
ALTER TABLE products ADD COLUMN IF NOT EXISTS point_rate NUMERIC DEFAULT 0;
COMMENT ON COLUMN products.point_rate IS 'ポイント付与率(%)。例: 1 = 1%ポイント付与。出品者負担ポイント原資として利益計算に反映。';
