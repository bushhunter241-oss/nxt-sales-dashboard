-- Migration 009: Add target_ad_budget to monthly_goals
ALTER TABLE monthly_goals
  ADD COLUMN IF NOT EXISTS target_ad_budget INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN monthly_goals.target_ad_budget IS '広告予算目標（円）。売上目標 × 目標TACoS で算出。';
