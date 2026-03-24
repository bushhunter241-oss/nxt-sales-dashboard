-- Migration 018: Add channel column to monthly_goals for channel-specific goal setting
ALTER TABLE monthly_goals
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'total';

-- 既存のUNIQUEインデックスを削除して新しいものに置き換え
DROP INDEX IF EXISTS monthly_goals_group_ym_key;
CREATE UNIQUE INDEX monthly_goals_group_ym_channel_key
  ON monthly_goals (product_group, year_month, channel)
  WHERE product_id IS NULL;

COMMENT ON COLUMN monthly_goals.channel IS 'チャネル。amazon / rakuten / total のいずれか。';
