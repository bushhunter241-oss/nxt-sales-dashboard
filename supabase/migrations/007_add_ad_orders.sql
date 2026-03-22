-- Migration 007: Add ad_orders column to daily_advertising
-- Stores the number of ad-attributed orders (purchases7d from Amazon Ads API)
-- Required for calculating Ad CVR = ad_orders / clicks

ALTER TABLE daily_advertising
  ADD COLUMN IF NOT EXISTS ad_orders INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN daily_advertising.ad_orders IS '広告経由の注文数（Amazon Ads APIのpurchases7dに対応）';
