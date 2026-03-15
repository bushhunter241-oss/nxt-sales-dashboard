-- ============================================
-- Migration 003: Fix ad_spend/ad_sales column types
-- Amazon Ads API returns decimal values for cost/sales
-- ============================================

-- Change ad_spend from INTEGER to NUMERIC(12,2)
ALTER TABLE daily_advertising
  ALTER COLUMN ad_spend TYPE NUMERIC(12,2) USING ad_spend::NUMERIC(12,2);

-- Change ad_sales from INTEGER to NUMERIC(12,2)
ALTER TABLE daily_advertising
  ALTER COLUMN ad_sales TYPE NUMERIC(12,2) USING ad_sales::NUMERIC(12,2);
