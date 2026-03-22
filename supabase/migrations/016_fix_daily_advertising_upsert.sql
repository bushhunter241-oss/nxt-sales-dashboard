-- ============================================
-- Migration 016: daily_advertising の upsert 対応
-- UNIQUE制約追加 + 重複データクリーンアップ
-- ============================================

-- 1. 既存の重複データをクリーンアップ（同一 product_id + date + campaign_type のレコードが複数ある場合、最新を残す）
DELETE FROM daily_advertising
WHERE id NOT IN (
  SELECT DISTINCT ON (product_id, date, campaign_type) id
  FROM daily_advertising
  ORDER BY product_id, date, campaign_type, created_at DESC
);

-- 2. UNIQUE制約を追加（product_id + date + campaign_type で一意にする）
ALTER TABLE daily_advertising
  ADD CONSTRAINT daily_advertising_product_date_type_unique
  UNIQUE (product_id, date, campaign_type);

-- 3. source カラムのCHECK制約を更新（'csv', 'ads-api' に加えて安全に）
-- 既存のCHECK制約を削除して再作成
DO $$
BEGIN
  ALTER TABLE daily_advertising DROP CONSTRAINT IF EXISTS daily_advertising_source_check;
  ALTER TABLE daily_advertising ADD CONSTRAINT daily_advertising_source_check
    CHECK (source IN ('csv', 'ads-api'));
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
