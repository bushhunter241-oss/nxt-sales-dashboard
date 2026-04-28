-- Migration 022: Add add_to_cart column to meta_ad_daily
ALTER TABLE meta_ad_daily ADD COLUMN IF NOT EXISTS add_to_cart INTEGER DEFAULT 0;
