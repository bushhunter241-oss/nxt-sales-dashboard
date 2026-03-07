import { refreshAccessToken } from "./auth";
import { AMAZON_CONFIG } from "./config";

const BASE_URL = AMAZON_CONFIG.SP_API_ENDPOINT;

interface SpApiRequestOptions {
  method?: "GET" | "POST";
  path: string;
  params?: Record<string, string>;
  body?: unknown;
}

/**
 * Make an authenticated request to SP-API
 */
async function spApiRequest<T>(options: SpApiRequestOptions): Promise<T> {
  const accessToken = await refreshAccessToken("sp-api");
  const { method = "GET", path, params, body } = options;

  let url = `${BASE_URL}${path}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  let retries = 0;
  while (retries <= AMAZON_CONFIG.MAX_RETRIES) {
    const response = await fetch(url, {
      method,
      headers: {
        "x-amz-access-token": accessToken,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.ok) {
      return response.json();
    }

    // Rate limit - wait and retry
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const waitMs = retryAfter
        ? parseInt(retryAfter) * 1000
        : AMAZON_CONFIG.INITIAL_RETRY_DELAY_MS * Math.pow(2, retries);
      await sleep(waitMs);
      retries++;
      continue;
    }

    // Server error - retry with backoff
    if (response.status >= 500) {
      const waitMs = AMAZON_CONFIG.INITIAL_RETRY_DELAY_MS * Math.pow(2, retries);
      await sleep(waitMs);
      retries++;
      continue;
    }

    // Client error - don't retry
    const errorText = await response.text();
    throw new Error(`SP-API error (${response.status}): ${errorText}`);
  }

  throw new Error("SP-API: Max retries exceeded");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================
// Orders API
// ============================================

interface SpApiOrder {
  AmazonOrderId: string;
  PurchaseDate: string;
  OrderStatus: string;
  OrderTotal?: { CurrencyCode: string; Amount: string };
  NumberOfItemsShipped: number;
  NumberOfItemsUnshipped: number;
}

interface SpApiOrderItem {
  ASIN: string;
  SellerSKU: string;
  OrderItemId: string;
  Title: string;
  QuantityOrdered: number;
  QuantityShipped: number;
  ItemPrice?: { CurrencyCode: string; Amount: string };
  ItemTax?: { CurrencyCode: string; Amount: string };
}

interface GetOrdersResponse {
  payload: {
    Orders: SpApiOrder[];
    NextToken?: string;
  };
}

interface GetOrderItemsResponse {
  payload: {
    OrderItems: SpApiOrderItem[];
    NextToken?: string;
  };
}

/**
 * Get orders within a date range
 */
export async function getOrders(
  startDate: string,
  endDate: string
): Promise<SpApiOrder[]> {
  const allOrders: SpApiOrder[] = [];
  let nextToken: string | undefined;

  do {
    const params: Record<string, string> = {
      MarketplaceIds: AMAZON_CONFIG.MARKETPLACE_ID,
      CreatedAfter: new Date(startDate).toISOString(),
      CreatedBefore: new Date(endDate + "T23:59:59").toISOString(),
      OrderStatuses: "Shipped,Unshipped,PartiallyShipped",
    };

    if (nextToken) {
      params.NextToken = nextToken;
    }

    const response = await spApiRequest<GetOrdersResponse>({
      path: "/orders/v0/orders",
      params,
    });

    allOrders.push(...response.payload.Orders);
    nextToken = response.payload.NextToken;

    // Rate limit: wait between paginated requests
    if (nextToken) await sleep(1000 / AMAZON_CONFIG.SP_API_RATE_LIMIT);
  } while (nextToken);

  return allOrders;
}

/**
 * Get order items for a specific order
 */
export async function getOrderItems(
  orderId: string
): Promise<SpApiOrderItem[]> {
  const allItems: SpApiOrderItem[] = [];
  let nextToken: string | undefined;

  do {
    const params: Record<string, string> = {};
    if (nextToken) params.NextToken = nextToken;

    const response = await spApiRequest<GetOrderItemsResponse>({
      path: `/orders/v0/orders/${orderId}/orderItems`,
      params,
    });

    allItems.push(...response.payload.OrderItems);
    nextToken = response.payload.NextToken;

    if (nextToken) await sleep(1000 / AMAZON_CONFIG.SP_API_RATE_LIMIT);
  } while (nextToken);

  return allItems;
}

// ============================================
// FBA Inventory API
// ============================================

interface FbaInventoryItem {
  asin: string;
  fnSku: string;
  sellerSku: string;
  condition: string;
  inventoryDetails: {
    fulfillableQuantity: number;
    inboundWorkingQuantity: number;
    inboundShippedQuantity: number;
    inboundReceivingQuantity: number;
    reservedQuantity: {
      totalReservedQuantity: number;
    };
  };
}

interface GetInventoryResponse {
  payload: {
    inventorySummaries: FbaInventoryItem[];
  };
  pagination?: {
    nextToken?: string;
  };
}

/**
 * Get FBA inventory summaries
 */
export async function getFbaInventory(): Promise<FbaInventoryItem[]> {
  const allItems: FbaInventoryItem[] = [];
  let nextToken: string | undefined;

  do {
    const params: Record<string, string> = {
      granularityType: "Marketplace",
      granularityId: AMAZON_CONFIG.MARKETPLACE_ID,
      marketplaceIds: AMAZON_CONFIG.MARKETPLACE_ID,
      details: "true",
    };
    if (nextToken) params.nextToken = nextToken;

    const response = await spApiRequest<GetInventoryResponse>({
      path: "/fba/inventory/v1/summaries",
      params,
    });

    allItems.push(...response.payload.inventorySummaries);
    nextToken = response.pagination?.nextToken;

    if (nextToken) await sleep(1000 / AMAZON_CONFIG.SP_API_RATE_LIMIT);
  } while (nextToken);

  return allItems;
}

export type { SpApiOrder, SpApiOrderItem, FbaInventoryItem };
