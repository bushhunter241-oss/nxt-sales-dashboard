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
    let params: Record<string, string>;

    if (nextToken) {
      // SP-API rule: when using NextToken, do NOT include any other parameters
      params = { NextToken: nextToken };
    } else {
      // Use JST (UTC+9) boundaries so date ranges match Amazon Seller Central (which shows in JST)
      const createdAfter = new Date(startDate + "T00:00:00+09:00");
      const endDateTime = new Date(endDate + "T23:59:59+09:00");

      // CreatedBefore must be at least 2 minutes before current time per SP-API rules
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
      const createdBefore = endDateTime > twoMinutesAgo ? twoMinutesAgo : endDateTime;

      params = {
        MarketplaceIds: AMAZON_CONFIG.MARKETPLACE_ID,
        CreatedAfter: createdAfter.toISOString(),
        CreatedBefore: createdBefore.toISOString(),
        OrderStatuses: "Shipped,Unshipped,PartiallyShipped",
      };
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
  // Sales data from salesByAsin
  orderedProductSales: number;
  unitsOrdered: number;
  totalOrderItems: number;
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
    salesByAsin?: {
      orderedProductSales?: { amount?: number; currencyCode?: string };
      unitsOrdered?: number;
      totalOrderItems?: number;
    };
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
    salesByDate?: {
      orderedProductSales?: { amount?: number };
      unitsOrdered?: number;
    };
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

  // Log available keys for debugging
  const availableKeys = Object.keys(reportJson);
  console.log(`[SP-API Reports] Response keys: ${availableKeys.join(", ")}`);

  if (reportJson.salesAndTrafficByAsin) {
    // salesAndTrafficByAsin contains per-ASIN data aggregated over the requested date range.
    // It does NOT contain a date field — each entry covers the full startDate..endDate range.
    // This is correct when called with a single day (startDate === endDate).
    if (startDate !== endDate) {
      console.warn(
        `[SP-API Reports] WARNING: salesAndTrafficByAsin requested for multi-day range ` +
        `(${startDate} to ${endDate}). Data will be aggregated, not per-day. ` +
        `Use single-day requests for accurate daily data.`
      );
    }

    for (const item of reportJson.salesAndTrafficByAsin) {
      const traffic = item.trafficByAsin;
      if (!traffic) continue;

      const sales = item.salesByAsin;
      rows.push({
        parentAsin: item.parentAsin || "",
        childAsin: item.childAsin || "",
        date: startDate,
        browserSessions: traffic.browserSessions || traffic.sessions || 0,
        pageViews: traffic.pageViews || traffic.browserPageViews || 0,
        buyBoxPercentage: traffic.buyBoxPercentage || 0,
        unitSessionPercentage: traffic.unitSessionPercentage || 0,
        orderedProductSales: sales?.orderedProductSales?.amount || 0,
        unitsOrdered: sales?.unitsOrdered || 0,
        totalOrderItems: sales?.totalOrderItems || 0,
      });
    }
  }

  console.log(`[SP-API Reports] Parsed ${rows.length} traffic rows for ${startDate}`);
  return rows;
}

// ============================================
// BSR Rankings via Catalog Items API (sub-category priority)
// ============================================

export interface CatalogBsrItem {
  asin: string;
  rankings: {
    categoryId: string;
    categoryName: string;
    rank: number;
  }[];
}

interface CatalogSalesRankEntry {
  classificationId?: string;
  title?: string;
  link?: string;
  rank?: number;
}

interface CatalogSalesRanksResponse {
  asin: string;
  salesRanks?: {
    marketplaceId: string;
    classificationRanks?: CatalogSalesRankEntry[];
    displayGroupRanks?: CatalogSalesRankEntry[];
  }[];
}

let bsrDebugInfo: string = "";

/**
 * Get BSR (Best Sellers Rank) for a product using the Catalog Items API.
 * Prioritizes classificationRanks (sub-category / 小カテゴリー) over
 * displayGroupRanks (main category / 大カテゴリー).
 *
 * Uses: GET /catalog/2022-04-01/items/{asin}?includedData=salesRanks
 */
export async function getCatalogItemBSR(asin: string): Promise<CatalogBsrItem | null> {
  try {
    const data = await spApiRequest<CatalogSalesRanksResponse>({
      method: "GET",
      path: `/catalog/2022-04-01/items/${asin}`,
      params: {
        marketplaceIds: AMAZON_CONFIG.MARKETPLACE_ID,
        includedData: "salesRanks",
      },
    });

    const salesRanks = data.salesRanks || [];
    const rankings: CatalogBsrItem["rankings"] = [];

    for (const sr of salesRanks) {
      // 1. Sub-category (classificationRanks) — prioritized
      const subCatRankings: CatalogBsrItem["rankings"] = [];
      if (sr.classificationRanks) {
        for (const cr of sr.classificationRanks) {
          if (cr.rank && cr.rank > 0) {
            subCatRankings.push({
              categoryId: cr.classificationId || "sub-category",
              categoryName: cr.title || "サブカテゴリー",
              rank: cr.rank,
            });
          }
        }
      }

      // 2. Main category (displayGroupRanks) — fallback only if no sub-category
      if (subCatRankings.length > 0) {
        rankings.push(...subCatRankings);
      } else if (sr.displayGroupRanks) {
        for (const dr of sr.displayGroupRanks) {
          if (dr.rank && dr.rank > 0) {
            rankings.push({
              categoryId: dr.link || "main-category",
              categoryName: dr.title || "大カテゴリー",
              rank: dr.rank,
            });
          }
        }
      }
    }

    if (rankings.length > 0) {
      console.log(`[BSR] ${asin}: ${rankings.map(r => `#${r.rank} in ${r.categoryName}`).join(", ")}`);
    } else {
      console.log(`[BSR] ${asin}: No BSR data from Catalog API`);
    }

    return { asin, rankings };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[BSR] ${asin}: Catalog API error: ${msg}`);
    bsrDebugInfo = `Catalog API error for ${asin}: ${msg}`;
    return { asin, rankings: [] };
  }
}

/**
 * Get debug info from the last BSR fetch (for API response)
 */
export function getListingsReportDebugInfo(): string {
  return bsrDebugInfo;
}

// ============================================
// Finances API (Actual FBA Fees per Order)
// ============================================

interface MoneyType {
  CurrencyCode: string;
  CurrencyAmount: number;
}

interface FeeComponent {
  FeeType: string;
  FeeAmount: MoneyType;
}

interface ShipmentItem {
  SellerSKU: string;
  OrderItemId: string;
  OrderAdjustmentItemId?: string;
  QuantityShipped: number;
  ItemChargeList?: Array<{ ChargeType: string; ChargeAmount: MoneyType }>;
  ItemFeeList?: FeeComponent[];
  PromotionList?: Array<{ PromotionType: string; PromotionId: string; PromotionAmount: MoneyType }>;
}

interface ShipmentEvent {
  AmazonOrderId?: string;
  PostedDate?: string;
  ShipmentItemList?: ShipmentItem[];
}

interface FinancialEvents {
  ShipmentEventList?: ShipmentEvent[];
  RefundEventList?: ShipmentEvent[];
}

interface GetFinancialEventsResponse {
  payload: {
    FinancialEvents: FinancialEvents;
    NextToken?: string;
  };
}

export interface FbaFeeByAsin {
  /** ASIN or SKU */
  sku: string;
  /** FBA配送手数料合計（FBAPerUnitFulfillmentFee の合計額） */
  totalFbaShippingFee: number;
  /** 対象の注文数 */
  orderCount: number;
  /** 1件あたりの平均FBA配送手数料 */
  avgFbaShippingFeePerUnit: number;
}

/**
 * SP-API Finances API から実際のFBA配送手数料を取得する
 * FBAPerUnitFulfillmentFee = Amazonが実際に請求したFBA送料
 *
 * @param startDate - 開始日 (YYYY-MM-DD, JST)
 * @param endDate   - 終了日 (YYYY-MM-DD, JST)
 * @returns SKU別のFBA配送手数料集計
 */
export async function getActualFbaFees(
  startDate: string,
  endDate: string
): Promise<FbaFeeByAsin[]> {
  const allEvents: ShipmentEvent[] = [];
  let nextToken: string | undefined;

  const postedAfter = new Date(startDate + "T00:00:00+09:00").toISOString();
  const postedBefore = new Date(endDate + "T23:59:59+09:00").toISOString();

  do {
    const params: Record<string, string> = {
      PostedAfter: postedAfter,
      PostedBefore: postedBefore,
    };
    if (nextToken) params.NextToken = nextToken;

    const response = await spApiRequest<GetFinancialEventsResponse>({
      path: "/finances/v0/financialEvents",
      params,
    });

    const events = response.payload?.FinancialEvents?.ShipmentEventList || [];
    allEvents.push(...events);
    nextToken = response.payload?.NextToken;

    if (nextToken) await sleep(1000);
  } while (nextToken);

  // SKU別にFBA配送手数料を集計
  const feeMap = new Map<string, { totalFee: number; count: number }>();

  for (const event of allEvents) {
    for (const item of event.ShipmentItemList || []) {
      const sku = item.SellerSKU;
      if (!sku) continue;

      const fbaFees = (item.ItemFeeList || []).filter(
        (f) => f.FeeType === "FBAPerUnitFulfillmentFee"
      );

      const itemFeeTotal = fbaFees.reduce(
        (sum, f) => sum + Math.abs(f.FeeAmount?.CurrencyAmount || 0),
        0
      );

      if (itemFeeTotal > 0) {
        const existing = feeMap.get(sku) || { totalFee: 0, count: 0 };
        existing.totalFee += itemFeeTotal;
        existing.count += item.QuantityShipped || 1;
        feeMap.set(sku, existing);
      }
    }
  }

  return Array.from(feeMap.entries()).map(([sku, data]) => ({
    sku,
    totalFbaShippingFee: Math.round(data.totalFee),
    orderCount: data.count,
    avgFbaShippingFeePerUnit: data.count > 0 ? Math.round(data.totalFee / data.count) : 0,
  }));
}

// ============================================
// Product Fees Estimation API
// ============================================

interface FeesEstimateResult {
  FBAFulfillmentFeePerUnit: number;
  ReferralFeePerUnit: number;
}

/**
 * Get FBA fee estimate for a given ASIN and price.
 * Uses /products/fees/v0/items/{Asin}/feesEstimate (no Finances permission needed).
 * Returns per-unit FBA fulfillment fee, or null on failure.
 */
export async function getFbaFeeEstimate(
  asin: string,
  price: number
): Promise<FeesEstimateResult | null> {
  try {
    const response = await spApiRequest<any>({
      method: "POST",
      path: `/products/fees/v0/items/${asin}/feesEstimate`,
      body: {
        FeesEstimateRequest: {
          MarketplaceId: AMAZON_CONFIG.MARKETPLACE_ID,
          IsAmazonFulfilled: true,
          PriceToEstimateFees: {
            ListingPrice: { CurrencyCode: "JPY", Amount: price },
          },
          Identifier: asin,
        },
      },
    });

    const feeDetail = response?.payload?.FeesEstimateResult?.FeesEstimate?.FeeDetailList;
    if (!feeDetail || !Array.isArray(feeDetail)) return null;

    let fbaFee = 0;
    let referralFee = 0;

    for (const fee of feeDetail) {
      if (fee.FeeType === "FBAFees") {
        fbaFee = Math.round(Math.abs(fee.FeeAmount?.Amount || 0));
      } else if (fee.FeeType === "ReferralFee") {
        referralFee = Math.round(Math.abs(fee.FeeAmount?.Amount || 0));
      }
    }

    return { FBAFulfillmentFeePerUnit: fbaFee, ReferralFeePerUnit: referralFee };
  } catch (err) {
    console.warn(`[SP-API Fees] Failed to estimate fees for ${asin}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

export type { SpApiOrder, SpApiOrderItem, FbaInventoryItem };
