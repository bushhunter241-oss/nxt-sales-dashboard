-- Migration 020: Enhance product_events with discount_rate and channel
ALTER TABLE product_events ADD COLUMN IF NOT EXISTS discount_rate NUMERIC DEFAULT 0;
ALTER TABLE product_events ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'both';
ALTER TABLE product_events ADD COLUMN IF NOT EXISTS title TEXT DEFAULT '';

COMMENT ON COLUMN product_events.discount_rate IS '割引率(%)。クーポン/タイムセール/ポイント施策時に設定。';
COMMENT ON COLUMN product_events.channel IS 'チャネル。amazon / rakuten / both のいずれか。';
COMMENT ON COLUMN product_events.title IS '施策タイトル。';
