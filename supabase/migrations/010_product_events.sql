-- Migration 010: Product events table for marketing campaign tracking
CREATE TABLE IF NOT EXISTS product_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  product_group TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'other',
  memo TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_events_date ON product_events (date);
CREATE INDEX IF NOT EXISTS idx_product_events_group ON product_events (product_group);

COMMENT ON TABLE product_events IS '施策・イベント管理テーブル。セール、画像変更、広告施策などの記録。';
COMMENT ON COLUMN product_events.event_type IS 'イベント種別: sale, image_change, ad_campaign, price_change, listing_update, other';
