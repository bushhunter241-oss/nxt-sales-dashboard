-- キャンペーン単位の広告データテーブル
-- spAdvertisedProduct レポートのASIN別データは二重計上されるため、
-- spCampaigns レポートのキャンペーン単位データを別途保存する
CREATE TABLE IF NOT EXISTS daily_campaign_advertising (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_name TEXT NOT NULL,
  campaign_id TEXT,
  date DATE NOT NULL,
  ad_spend NUMERIC(12,2) NOT NULL DEFAULT 0,
  ad_sales NUMERIC(12,2) NOT NULL DEFAULT 0,
  ad_orders INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  acos NUMERIC(10,2) DEFAULT 0,
  roas NUMERIC(10,2) DEFAULT 0,
  product_group TEXT,
  source TEXT DEFAULT 'ads-api',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_name, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_campaign_ad_date ON daily_campaign_advertising(date);
CREATE INDEX IF NOT EXISTS idx_daily_campaign_ad_group ON daily_campaign_advertising(product_group);
