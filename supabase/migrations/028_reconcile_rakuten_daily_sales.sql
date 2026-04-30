-- 028_reconcile_rakuten_daily_sales.sql
-- rakuten_daily_sales が rakuten_daily_sku_sales と乖離しているケースの修復。
--
-- 背景:
--   sync.ts の aggregateOrders() は同じ受注データから byManageNumber と bySku の
--   2つの集計を生成し、それぞれ rakuten_daily_sales / rakuten_daily_sku_sales に
--   upsert している。本来この2テーブルの (manage_number, date) 単位の合計は一致するはず。
--   しかし実データで乖離が発生（例: feela01 4月の daily=42個 vs sku=53個）。
--   原因として CSV import と API sync の混在、または upsert 中の部分失敗が想定される。
--
-- 対処:
--   rakuten_daily_sku_sales を真値とみなし、daily_sales を再集計値で上書きする。
--   ただし access_count / cvr / cancellations はアクセスCSV由来なので保持する。
--
-- 影響範囲: rakuten_daily_sku_sales に存在するすべての (manage_number, date)。

-- Step 1: 既存レコードを SKU 集計値で上書き
WITH sku_agg AS (
  SELECT
    manage_number,
    date,
    SUM(units_sold)::int   AS units_sold,
    SUM(sales_amount)::int AS sales_amount,
    SUM(orders)::int       AS orders
  FROM rakuten_daily_sku_sales
  GROUP BY manage_number, date
)
UPDATE rakuten_daily_sales rds
SET
  units_sold   = sku_agg.units_sold,
  sales_amount = sku_agg.sales_amount,
  orders       = sku_agg.orders,
  source       = 'rebuilt-from-sku'
FROM sku_agg
INNER JOIN rakuten_products rp ON rp.product_id = sku_agg.manage_number
WHERE rds.product_id = rp.id
  AND rds.date       = sku_agg.date
  AND (
    rds.units_sold   <> sku_agg.units_sold
    OR rds.sales_amount <> sku_agg.sales_amount
    OR rds.orders       <> sku_agg.orders
  );

-- Step 2: SKU 側にあって daily_sales に存在しない (manage_number, date) を新規挿入
INSERT INTO rakuten_daily_sales
  (product_id, date, units_sold, sales_amount, orders, access_count, cvr, cancellations, source)
SELECT
  rp.id,
  sku_agg.date,
  sku_agg.units_sold,
  sku_agg.sales_amount,
  sku_agg.orders,
  0, 0, 0,
  'rebuilt-from-sku'
FROM (
  SELECT
    manage_number,
    date,
    SUM(units_sold)::int   AS units_sold,
    SUM(sales_amount)::int AS sales_amount,
    SUM(orders)::int       AS orders
  FROM rakuten_daily_sku_sales
  GROUP BY manage_number, date
) sku_agg
INNER JOIN rakuten_products rp ON rp.product_id = sku_agg.manage_number
LEFT JOIN rakuten_daily_sales rds
  ON rds.product_id = rp.id
 AND rds.date       = sku_agg.date
WHERE rds.id IS NULL;
