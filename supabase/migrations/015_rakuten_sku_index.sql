-- rakuten_products.sku にインデックスを追加（子商品SKU検索の高速化）
CREATE INDEX IF NOT EXISTS idx_rakuten_products_sku ON rakuten_products(sku);
