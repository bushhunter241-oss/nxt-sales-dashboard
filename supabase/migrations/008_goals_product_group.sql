-- Migration 008: Add product_group to monthly_goals for group-level goal setting
-- Allows setting goals per product_group instead of per product

ALTER TABLE monthly_goals
  ADD COLUMN IF NOT EXISTS product_group TEXT;

-- Unique index for group-level goals (product_id is NULL, product_group is set)
CREATE UNIQUE INDEX IF NOT EXISTS monthly_goals_group_ym_key
  ON monthly_goals (product_group, year_month)
  WHERE product_id IS NULL AND product_group IS NOT NULL;

COMMENT ON COLUMN monthly_goals.product_group IS '商品グループ名。グループ単位の目標設定に使用。product_id=NULLの場合にグループ目標として扱う。';
