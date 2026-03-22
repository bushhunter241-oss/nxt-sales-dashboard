-- ============================================
-- Migration 017: Amazon月別広告費オーバーライドテーブル
-- CSVから取り込んだ「正確な月別広告費合計」を保存し、
-- ダッシュボードの月別集計でこちらを優先表示する
-- ============================================

CREATE TABLE IF NOT EXISTS amazon_monthly_ad_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month TEXT NOT NULL UNIQUE,       -- 例: '2026-01'
  total_ad_spend INTEGER NOT NULL DEFAULT 0,
  total_ad_sales INTEGER NOT NULL DEFAULT 0,
  total_ad_orders INTEGER NOT NULL DEFAULT 0,
  total_impressions INTEGER NOT NULL DEFAULT 0,
  total_clicks INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'csv',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS設定
ALTER TABLE amazon_monthly_ad_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON amazon_monthly_ad_overrides FOR ALL USING (true);
