-- Migration 023: Ensure target_profit and target_ad_budget exist on monthly_goals
-- (originally defined in 001 and 009, but may not have been applied)
ALTER TABLE monthly_goals ADD COLUMN IF NOT EXISTS target_profit INTEGER NOT NULL DEFAULT 0;
ALTER TABLE monthly_goals ADD COLUMN IF NOT EXISTS target_ad_budget INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN monthly_goals.target_profit IS '利益目標（円）';
COMMENT ON COLUMN monthly_goals.target_ad_budget IS '広告予算目標（円）。売上目標 × 目標TACoS で算出。';
