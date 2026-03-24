/**
 * Shopify Admin API client
 * OAuth認証で取得したアクセストークンをDBから読み取って使用
 */
import { createClient } from "@supabase/supabase-js";

const API_VERSION = "2024-01";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function getAccessToken(): Promise<{ token: string; domain: string }> {
  // 1. 環境変数に直接設定されていればそちらを使用
  if (process.env.SHOPIFY_ACCESS_TOKEN && process.env.SHOPIFY_STORE_DOMAIN) {
    return { token: process.env.SHOPIFY_ACCESS_TOKEN, domain: process.env.SHOPIFY_STORE_DOMAIN };
  }

  // 2. DBからOAuth認証済みトークンを取得
  const db = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await db
    .from("api_credentials")
    .select("access_token, profile_id")
    .eq("credential_type", "shopify")
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data?.access_token) {
    throw new Error("Shopifyアクセストークンが未設定です。API連携設定ページでShopify連携を行ってください。");
  }

  return { token: data.access_token, domain: data.profile_id || process.env.SHOPIFY_STORE_DOMAIN || "" };
}

async function shopifyFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const { token, domain } = await getAccessToken();
  if (!domain) throw new Error("SHOPIFY_STORE_DOMAIN が未設定です");

  const url = new URL(`https://${domain}/admin/api/${API_VERSION}${path}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
  });

  if (res.status === 429) {
    const retryAfter = parseFloat(res.headers.get("Retry-After") || "2");
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return shopifyFetch<T>(path, params);
  }

  if (res.status === 401) {
    throw new Error("Shopifyアクセストークンが無効です。API連携設定ページで再連携してください。");
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API error (${res.status}): ${text}`);
  }

  return res.json();
}

export interface ShopifyOrder {
  id: number;
  name: string;
  created_at: string;
  financial_status: string;
  total_price: string;
  total_discounts: string;
  total_tax: string;
  line_items: Array<{
    id: number;
    title: string;
    variant_title: string | null;
    sku: string;
    quantity: number;
    price: string;
    total_discount: string;
  }>;
  refunds: Array<{
    refund_line_items: Array<{
      line_item_id: number;
      quantity: number;
      subtotal: number;
    }>;
  }>;
}

/**
 * Fetch orders for a date range (handles pagination)
 */
export async function fetchOrders(dateFrom: string, dateTo: string): Promise<ShopifyOrder[]> {
  const orders: ShopifyOrder[] = [];
  let params: Record<string, string> = {
    created_at_min: `${dateFrom}T00:00:00+09:00`,
    created_at_max: `${dateTo}T23:59:59+09:00`,
    status: "any",
    limit: "250",
    fields: "id,name,created_at,financial_status,total_price,total_discounts,total_tax,line_items,refunds",
  };

  while (true) {
    const data = await shopifyFetch<{ orders: ShopifyOrder[] }>("/orders.json", params);
    orders.push(...data.orders);

    if (data.orders.length < 250) break;
    params = { ...params, since_id: String(data.orders[data.orders.length - 1].id) };

    await new Promise(r => setTimeout(r, 500));
  }

  return orders;
}

/**
 * Test connection by fetching shop info
 */
export async function testConnection(): Promise<{ success: boolean; shopName?: string; error?: string }> {
  try {
    const data = await shopifyFetch<{ shop: { name: string; domain: string } }>("/shop.json");
    return { success: true, shopName: data.shop.name };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
