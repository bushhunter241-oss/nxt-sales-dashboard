-- Migration: Add fba_shipping_fee to products table
-- FBA送料（配送手数料）= per-unit fulfillment fee charged by Amazon FBA
-- Separate from fba_fee_rate which is the % referral fee (紹介料)

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS fba_shipping_fee INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN products.fba_shipping_fee IS 'FBA配送手数料（1個あたりの固定額、単位：円）。Amazonが実際に請求するFBA送料。紹介料(fba_fee_rate)とは別。';
