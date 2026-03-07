-- ============================================
-- Migration 002: API Integration Schema
-- Amazon SP-API & Ads API 連携用テーブル追加
-- ============================================

-- 1. API認証情報テーブル
CREATE TABLE IF NOT EXISTS api_credentials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('sp-api', 'ads-api')),
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  token_expires_at TIMESTAMPTZ,
  profile_id TEXT, -- Ads API profile ID
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (credential_type)
);

-- 2. API同期ログテーブル
CREATE TABLE IF NOT EXISTS api_sync_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  api_type TEXT NOT NULL CHECK (api_type IN ('sp-api-orders', 'sp-api-inventory', 'ads-api')),
  sync_type TEXT NOT NULL DEFAULT 'manual' CHECK (sync_type IN ('manual', 'cron')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'success', 'failed')),
  start_date DATE,
  end_date DATE,
  records_processed INTEGER DEFAULT 0,
  error_message TEXT,
  sync_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sync_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. 既存テーブル拡張: daily_sales に source カラム追加
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_sales' AND column_name = 'source'
  ) THEN
    ALTER TABLE daily_sales ADD COLUMN source TEXT DEFAULT 'csv' CHECK (source IN ('csv', 'sp-api'));
  END IF;
END $$;

-- 4. 既存テーブル拡張: daily_advertising に source カラム追加
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_advertising' AND column_name = 'source'
  ) THEN
    ALTER TABLE daily_advertising ADD COLUMN source TEXT DEFAULT 'csv' CHECK (source IN ('csv', 'ads-api'));
  END IF;
END $$;

-- 5. インデックス
CREATE INDEX IF NOT EXISTS idx_api_sync_logs_type_date ON api_sync_logs(api_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_credentials_type ON api_credentials(credential_type);

-- 6. RLSポリシー（単一ユーザーなので全許可）
ALTER TABLE api_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on api_credentials" ON api_credentials FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on api_sync_logs" ON api_sync_logs FOR ALL USING (true) WITH CHECK (true);
