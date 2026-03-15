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
    // Use JST (UTC+9) boundaries so date ranges match Amazon Seller Central (which shows in JST)
    // e.g. startDate="2026-03-06" → CreatedAfter="2026-03-06T00:00:00+09:00" = "2026-03-05T15:00:00Z"
    const createdAfter = new Date(startDate + "T00:00:00+09:00");
    const endDateTime = new Date(endDate + "T23:59:59+09:00");

    // CreatedBefore must be at least 2 minutes before current time per SP-API rules
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    const createdBefore = endDateTime > twoMinutesAgo ? twoMinutesAgo : endDateTime;

    const params: Record<string, string> = {
      MarketplaceIds: AMAZON_CONFIG.MARKETPLACE_ID,
      CreatedAfter: createdAfter.toISOString(),
      CreatedBefore: createdBefore.toISOString(),
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

// ============================================
// Reports API (Sales & Traffic)
// ============================================

interface CreateReportResponse {
  reportId: string;
}

interface ReportStatus {
  reportId: string;
  reportType: string;
  processingStatus: string;
  reportDocumentId?: string;
}

interface ReportDocument {
  reportDocumentId: string;
  url: string;
  compressionAlgorithm?: string;
}

export interface SalesTrafficRow {
  parentAsin: string;
  childAsin: string;
  date: string;
  browserSessions: number;
  pageViews: number;
  buyBoxPercentage: number;
  unitSessionPercentage: number;
}

/**
 * Create a Sales & Traffic report request
 */
export async function createSalesTrafficReport(
  startDate: string,
  endDate: string
): Promise<string> {
  const data = await spApiRequest<CreateReportResponse>({
    method: "POST",
    path: "/reports/2021-06-30/reports",
    body: {
      reportType: "GET_SALES_AND_TRAFFIC_REPORT",
      dataStartTime: startDate + "T00:00:00Z",
      dataEndTime: endDate + "T23:59:59Z",
      marketplaceIds: [AMAZON_CONFIG.MARKETPLACE_ID],
      reportOptions: {
        dateGranularity: "DAY",
        asinGranularity: "CHILD",
      },
    },
  });
  return data.reportId;
}

/**
 * Get report processing status
 */
export async function getReportStatus(reportId: string): Promise<ReportStatus> {
  return spApiRequest<ReportStatus>({
    path: `/reports/2021-06-30/reports/${reportId}`,
  });
}

/**
 * Get report document download URL
 */
export async function getReportDocument(
  reportDocumentId: string
): Promise<ReportDocument> {
  return spApiRequest<ReportDocument>({
    path: `/reports/2021-06-30/documents/${reportDocumentId}`,
  });
}

/**
 * Download and parse a Sales & Traffic report
 * Creates report, polls for completion, downloads and parses JSON
 * Handles gzip-compressed responses from SP-API
 */
export async function downloadSalesTrafficReport(
  startDate: string,
  endDate: string,
  maxWaitMs: number = 45000
): Promise<SalesTrafficRow[]> {
  // 1. Create report
  console.log(`[SP-API Reports] Creating sales/traffic report for ${startDate} to ${endDate}`);
  const reportId = await createSalesTrafficReport(startDate, endDate);
  console.log(`[SP-API Reports] Report created: ${reportId}`);

  // 2. Poll for completion
  const startTime = Date.now();
  let status: ReportStatus;

  while (true) {
    await sleep(5000); // Wait 5s between polls
    status = await getReportStatus(reportId);
    console.log(`[SP-API Reports] Status: ${status.processingStatus}`);

    if (status.processingStatus === "DONE") break;
    if (status.processingStatus === "FATAL" || status.processingStatus === "CANCELLED") {
      console.error(`[SP-API Reports] Report failed: ${status.processingStatus}`);
      return [];
    }

    if (Date.now() - startTime > maxWaitMs) {
      console.warn(`[SP-API Reports] Timeout after ${maxWaitMs}ms, report not ready`);
      return [];
    }
  }

  // 3. Get document URL
  if (!status!.reportDocumentId) {
    console.error("[SP-API Reports] No reportDocumentId");
    return [];
  }

  const doc = await getReportDocument(status!.reportDocumentId);
  console.log(`[SP-API Reports] Downloading document, compression: ${doc.compressionAlgorithm || "none"}`);

  // 4. Download the report (handle gzip if needed)
  const response = await fetch(doc.url);
  if (!response.ok) {
    throw new Error(`Failed to download report: ${response.status}`);
  }

  let reportText: string;

  if (doc.compressionAlgorithm === "GZIP") {
    // Decompress gzip response
    const buffer = await response.arrayBuffer();
    const ds = new DecompressionStream("gzip");
    const decompressedStream = new Response(
      new Blob([buffer]).stream().pipeThrough(ds)
    );
    reportText = await decompressedStream.text();
  } else {
    reportText = await response.text();
  }

  // 5. Parse JSON
  let reportJson: { salesAndTrafficByAsin?: Array<{
    parentAsin: string;
    childAsin: string;
    trafficByAsin?: {
      browserSessions?: number;
      sessions?: number;
      pageViews?: number;
      browserPageViews?: number;
      buyBoxPercentage?: number;
      unitSessionPercentage?: number;
    };
  }>; salesAndTrafficByDate?: Array<{
    date: string;
    trafficByDate?: {
      browserSessions?: number;
      sessions?: number;
      pageViews?: number;
      browserPageViews?: number;
    };
  }> };

  try {
    reportJson = JSON.parse(reportText);
  } catch (e) {
    console.error("[SP-API Reports] Failed to parse report JSON:", reportText.substring(0, 200));
    throw new Error(`Report JSON parse error: ${(e as Error).message}`);
  }

  // 6. Extract rows
  const rows: SalesTrafficRow[] = [];

  if (reportJson.salesAndTrafficByAsin) {
    // ASIN-level granularity report
    for (const item of reportJson.salesAndTrafficByAsin) {
      const traffic = item.trafficByAsin;
      if (!traffic) continue;

      rows.push({
        parentAsin: item.parentAsin || "",
        childAsin: item.childAsin || "",
        date: startDate, // Will be set per-date if date granularity is DAY
        browserSessions: traffic.browserSessions || traffic.sessions || 0,
        pageViews: traffic.pageViews || traffic.browserPageViews || 0,
        buyBoxPercentage: traffic.buyBoxPercentage || 0,
        unitSessionPercentage: traffic.unitSessionPercentage || 0,
      });
    }
  }

  console.log(`[SP-API Reports] Parsed ${rows.length} traffic rows`);
  return rows;
}

export type { SpApiOrder, SpApiOrderItem, FbaInventoryItem };
