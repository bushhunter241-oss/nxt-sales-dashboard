-- Amazon月別売上オーバーライドテーブル
-- CSVから取り込んだ「正確な月別合計」をここに保存し、
-- ダッシュボードのmonthly集計でこちらを優先表示する
CREATE TABLE IF NOT EXISTS amazon_monthly_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month TEXT NOT NULL UNIQUE, -- 例: '2026-01'
  total_sales INTEGER NOT NULL,
  total_orders INTEGER NOT NULL DEFAULT 0,
  total_units INTEGER NOT NULL DEFAULT 0,
  sessions INTEGER NOT NULL DEFAULT 0,
  cvr NUMERIC(5,2) NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'csv',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS設定
ALTER TABLE amazon_monthly_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON amazon_monthly_overrides FOR ALL USING (true);
