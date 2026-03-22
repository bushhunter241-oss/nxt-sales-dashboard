export interface Product {
  id: string;
  name: string;
  code: string;
  asin: string | null;
  sku: string | null;
  selling_price: number;
  cost_price: number;
  /** Amazon紹介料率（%）。売上に対する割合。例: 15 = 15% */
  fba_fee_rate: number;
  /** FBA配送手数料（1個あたり固定額、円）。Amazon FBAが実際に請求する配送手数料。 */
  fba_shipping_fee: number;
  category: string | null;
  product_group: string | null;
  parent_asin: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface DailySales {
  id: string;
  product_id: string;
  date: string;
  sessions: number;
  orders: number;
  sales_amount: number;
  units_sold: number;
  cvr: number;
  cancellations: number;
  source?: 'csv' | 'sp-api';
  created_at: string;
}

export interface DailyAdvertising {
  id: string;
  product_id: string;
  date: string;
  ad_spend: number;
  ad_sales: number;
  ad_orders: number;
  impressions: number;
  clicks: number;
  acos: number;
  roas: number;
  campaign_name: string | null;
  campaign_type: string;
  source?: 'csv' | 'ads-api';
  created_at: string;
}

export interface Expense {
  id: string;
  product_id: string | null;
  date: string;
  expense_type: 'fee' | 'shipping' | 'other';
  amount: number;
  notes: string | null;
  created_at: string;
}

export interface Inventory {
  id: string;
  product_id: string;
  current_stock: number;
  reorder_point: number;
  lead_days: number;
  last_restocked_at: string | null;
  notes: string | null;
  updated_at: string;
}

export interface InventoryLog {
  id: string;
  product_id: string;
  date: string;
  change_amount: number;
  change_type: 'inbound' | 'outbound' | 'adjustment';
  notes: string | null;
  created_at: string;
}

export interface MonthlyGoal {
  id: string;
  product_id: string | null;
  product_group: string | null;
  year_month: string;
  target_sales: number;
  target_orders: number;
  target_profit: number;
  target_ad_budget: number;
  created_at: string;
}

export interface BsrRanking {
  id: string;
  product_id: string;
  product_group: string | null;
  asin: string;
  category_id: string;
  category_name: string;
  rank: number;
  recorded_at: string;
  created_at: string;
}

export interface ProductEvent {
  id: string;
  date: string;
  product_group: string;
  event_type: string;
  memo: string;
  created_at: string;
}

// Joined/computed types
export interface DailySalesWithProduct extends DailySales {
  product: Product;
}

export interface ProductWithStats extends Product {
  total_sales: number;
  total_orders: number;
  total_profit: number;
  profit_rate: number;
  total_sessions: number;
  avg_cvr: number;
}

export interface DashboardSummary {
  total_sales: number;
  total_profit: number;
  profit_rate: number;
  total_orders: number;
  total_sessions: number;
  avg_cvr: number;
  total_ad_spend: number;
  tacos: number;
  total_cost: number;
  total_fees: number;
}

// API Integration types
export interface ApiCredential {
  id: string;
  credential_type: 'sp-api' | 'ads-api';
  client_id: string;
  client_secret: string;
  refresh_token: string;
  access_token: string | null;
  token_expires_at: string | null;
  profile_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ApiSyncLog {
  id: string;
  api_type: 'sp-api-orders' | 'sp-api-inventory' | 'sp-api-traffic' | 'sp-api-bsr' | 'ads-api';
  sync_type: 'manual' | 'cron';
  status: 'pending' | 'running' | 'success' | 'failed';
  start_date: string | null;
  end_date: string | null;
  records_processed: number;
  error_message: string | null;
  sync_started_at: string;
  sync_completed_at: string | null;
  created_at: string;
}

// ── 楽天 ──────────────────────────────────
export interface RakutenProduct {
  id: string;
  name: string;
  product_id: string; // 商品管理番号
  sku: string | null;
  selling_price: number;
  cost_price: number;
  fee_rate: number; // 楽天手数料率(%)
  shipping_fee: number; // 1個あたり配送コスト（円）
  parent_product_id: string | null; // 親商品の商品管理番号（NULLなら親商品）
  category: string | null;
  product_group: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface RakutenDailySales {
  id: string;
  product_id: string; // references rakuten_products.id
  date: string;
  access_count: number; // アクセス数（Amazonのsessionsに相当）
  orders: number;
  sales_amount: number;
  units_sold: number;
  cvr: number;
  cancellations: number;
  source: 'csv' | 'api';
  created_at: string;
}

export interface RakutenDailyAdvertising {
  id: string;
  product_id: string;
  date: string;
  ad_spend: number;
  ad_sales: number;
  impressions: number;
  clicks: number;
  acos: number;
  roas: number;
  campaign_name: string | null;
  campaign_type: string; // RPP, CPC, etc.
  source: 'csv' | 'api';
  created_at: string;
}

export interface RakutenDailySalesWithProduct extends RakutenDailySales {
  rakuten_product: RakutenProduct;
}
