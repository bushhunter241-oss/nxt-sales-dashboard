-- Migration 013: 楽天商品マスタの初期データ登録
-- 「商品別_原価_送料まとめ.xlsx」を元に作成
-- ※ product_id（楽天管理番号）は仮IDです。実際の楽天管理番号に更新してください。
-- ※ selling_price（販売価格）は 0 で登録されます。実際の価格をUIから更新してください。

-- ─────────────────────────────────────────
-- feela ブランド
-- ─────────────────────────────────────────
INSERT INTO rakuten_products (name, product_id, product_group, cost_price, shipping_fee, selling_price, fee_rate, category)
VALUES
  ('feela シートクッション', 'feela-seat-cushion', 'feela', 3100, 704, 0, 10, 'クッション')
ON CONFLICT (product_id) DO UPDATE SET
  cost_price    = EXCLUDED.cost_price,
  shipping_fee  = EXCLUDED.shipping_fee,
  product_group = EXCLUDED.product_group,
  category      = EXCLUDED.category,
  updated_at    = NOW();

-- ─────────────────────────────────────────
-- MobiStick ブランド
-- ─────────────────────────────────────────
INSERT INTO rakuten_products (name, product_id, product_group, cost_price, shipping_fee, selling_price, fee_rate, category)
VALUES
  ('MobiStick', 'mobistick-01', 'MobiStick', 821, 0, 0, 10, 'その他')
ON CONFLICT (product_id) DO UPDATE SET
  cost_price    = EXCLUDED.cost_price,
  shipping_fee  = EXCLUDED.shipping_fee,
  product_group = EXCLUDED.product_group,
  category      = EXCLUDED.category,
  updated_at    = NOW();

-- ─────────────────────────────────────────
-- imin01 ブランド（ホワイトセージ系）
-- ─────────────────────────────────────────
INSERT INTO rakuten_products (name, product_id, product_group, cost_price, shipping_fee, selling_price, fee_rate, category)
VALUES
  ('ホワイトセージ 30g',         'imin01-30g',            'imin01', 303,  251, 0, 10, 'お香・浄化グッズ'),
  ('ホワイトセージ 50g',         'imin01-50g',            'imin01', 441,  251, 0, 10, 'お香・浄化グッズ'),
  ('ホワイトセージ 100g',        'imin01-100g',           'imin01', 784,  251, 0, 10, 'お香・浄化グッズ'),
  ('八角浄化皿 GOLD',            'imin01-hakkaku-gold',   'imin01', 474,  251, 0, 10, 'お香・浄化グッズ'),
  ('八角浄化皿 WATER',           'imin01-hakkaku-water',  'imin01', 455,  527, 0, 10, 'お香・浄化グッズ'),
  ('浄め塩 ホワイトセージ 10g',  'imin01-kiyome-10g',     'imin01',  79,  251, 0, 10, 'お香・浄化グッズ'),
  ('限定セット',                 'imin01-limited-set',    'imin01', 699,  251, 0, 10, 'お香・浄化グッズ'),
  ('クラッシュ',                 'imin01-crush',          'imin01', 1008, 251, 0, 10, 'お香・浄化グッズ')
ON CONFLICT (product_id) DO UPDATE SET
  cost_price    = EXCLUDED.cost_price,
  shipping_fee  = EXCLUDED.shipping_fee,
  product_group = EXCLUDED.product_group,
  category      = EXCLUDED.category,
  updated_at    = NOW();

-- ─────────────────────────────────────────
-- imin02 ブランド
-- ─────────────────────────────────────────
INSERT INTO rakuten_products (name, product_id, product_group, cost_price, shipping_fee, selling_price, fee_rate, category)
VALUES
  ('Moon缶',   'imin02-moon-can',  'imin02', 499, 527, 0, 10, 'お香・浄化グッズ'),
  ('Moon100',  'imin02-moon100',   'imin02', 950, 527, 0, 10, 'お香・浄化グッズ'),
  ('18g',      'imin02-18g',       'imin02', 172, 251, 0, 10, 'お香・浄化グッズ'),
  ('35g',      'imin02-35g',       'imin02', 316, 251, 0, 10, 'お香・浄化グッズ')
ON CONFLICT (product_id) DO UPDATE SET
  cost_price    = EXCLUDED.cost_price,
  shipping_fee  = EXCLUDED.shipping_fee,
  product_group = EXCLUDED.product_group,
  category      = EXCLUDED.category,
  updated_at    = NOW();

-- ─────────────────────────────────────────
-- imin03 ブランド（浄化香系）
-- ─────────────────────────────────────────
INSERT INTO rakuten_products (name, product_id, product_group, cost_price, shipping_fee, selling_price, fee_rate, category)
VALUES
  ('浄化香 2.8mm 33本', 'imin03-joka-28mm-33', 'imin03', 256, 251, 0, 10, 'お香・浄化グッズ'),
  ('浄化香 2.1mm 40本', 'imin03-joka-21mm-40', 'imin03', 278, 251, 0, 10, 'お香・浄化グッズ'),
  ('浄化香 80本',       'imin03-joka-80',      'imin03', 338, 251, 0, 10, 'お香・浄化グッズ'),
  ('浄化香 120本',      'imin03-joka-120',     'imin03', 432, 251, 0, 10, 'お香・浄化グッズ'),
  ('香立 巳',          'imin03-koudai-mi',    'imin03', 372, 251, 0, 10, 'お香・浄化グッズ'),
  ('ライター',          'imin03-lighter',      'imin03', 480, 251, 0, 10, 'お香・浄化グッズ')
ON CONFLICT (product_id) DO UPDATE SET
  cost_price    = EXCLUDED.cost_price,
  shipping_fee  = EXCLUDED.shipping_fee,
  product_group = EXCLUDED.product_group,
  category      = EXCLUDED.category,
  updated_at    = NOW();

-- ─────────────────────────────────────────
-- imin05 ブランド
-- ─────────────────────────────────────────
INSERT INTO rakuten_products (name, product_id, product_group, cost_price, shipping_fee, selling_price, fee_rate, category)
VALUES
  ('P-set',     'imin05-p-set',      'imin05', 514, 251, 0, 10, 'お香・浄化グッズ'),
  ('パウダー',   'imin05-powder',     'imin05', 283, 251, 0, 10, 'お香・浄化グッズ'),
  ('季節ブレンド', 'imin05-seasonal', 'imin05', 283, 251, 0, 10, 'お香・浄化グッズ'),
  ('Gold',      'imin05-gold',       'imin05', 412, 251, 0, 10, 'お香・浄化グッズ')
ON CONFLICT (product_id) DO UPDATE SET
  cost_price    = EXCLUDED.cost_price,
  shipping_fee  = EXCLUDED.shipping_fee,
  product_group = EXCLUDED.product_group,
  category      = EXCLUDED.category,
  updated_at    = NOW();
