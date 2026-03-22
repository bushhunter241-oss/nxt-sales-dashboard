-- 楽天売上CSVインポート用: access_count/cvr を保持しつつ売上フィールドのみ更新するRPC関数
CREATE OR REPLACE FUNCTION upsert_rakuten_sales(
  p_product_id UUID,
  p_date DATE,
  p_sales_amount NUMERIC,
  p_orders INTEGER,
  p_units_sold INTEGER,
  p_source TEXT DEFAULT 'csv'
) RETURNS VOID AS $$
BEGIN
  INSERT INTO rakuten_daily_sales (product_id, date, sales_amount, orders, units_sold, access_count, cvr, cancellations, source)
  VALUES (p_product_id, p_date, p_sales_amount, p_orders, p_units_sold, 0, 0, 0, p_source)
  ON CONFLICT (product_id, date)
  DO UPDATE SET
    sales_amount = EXCLUDED.sales_amount,
    orders = EXCLUDED.orders,
    units_sold = EXCLUDED.units_sold,
    source = EXCLUDED.source;
    -- access_count, cvr は更新しない → 既存値が保持される
END;
$$ LANGUAGE plpgsql;
