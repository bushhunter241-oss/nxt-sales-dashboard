-- 027_fix_rhinon_fee_rate.sql
-- RHINON ノートパソコンスタンド (mobistick) のマスタ修正:
--   1. Amazon紹介料率: 15% → 10% （正しいカテゴリ料率）
--   2. B0CF3XL3F9 (ms02) の FBA配送手数料: 0円 → 318円 （計上漏れ）
-- 根拠: amazon利益.xlsx の mobistick シート設定値（送料=318, 手数料=10%）。
-- B0CF3ZZHK9 (ms01) の送料は既に 318 のため変更不要。

UPDATE products
SET fba_fee_rate = 10.0,
    updated_at = NOW()
WHERE asin IN ('B0CF3XL3F9', 'B0CF3ZZHK9')
  AND product_group = 'RHINON';

UPDATE products
SET fba_shipping_fee = 318,
    updated_at = NOW()
WHERE asin = 'B0CF3XL3F9'
  AND product_group = 'RHINON';
