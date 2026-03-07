import { refreshAccessToken, getCredentials } from "./auth";
import { AMAZON_CONFIG } from "./config";

const BASE_URL = AMAZON_CONFIG.ADS_API_ENDPOINT;

interface AdsApiRequestOptions {
  method?: "GET" | "POST";
  path: string;
  body?: unknown;
  profileId?: string;
}

/**
 * Make an authenticated request to Amazon Ads API
 */
async function adsApiRequest<T>(options: AdsApiRequestOptions): Promise<T> {
  const accessToken = await refreshAccessToken("ads-api");
  const { method = "GET", path, body, profileId } = options;

  // Get profile ID from credentials if not provided
  let pId = profileId;
  if (!pId) {
    const creds = await getCredentials("ads-api");
    pId = creds?.profile_id || undefined;
  }

  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "Amazon-Advertising-API-ClientId":
      (await getCredentials("ads-api"))?.client_id || "",
  };

  if (pId) {
    headers["Amazon-Advertising-API-Scope"] = pId;
  }

  let retries = 0;
  while (retries <= AMAZON_CONFIG.MAX_RETRIES) {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.ok) {
      return response.json();
    }

    if (response.status === 429) {
      const waitMs =
        AMAZON_CONFIG.INITIAL_RETRY_DELAY_MS * Math.pow(2, retries);
      await sleep(waitMs);
      retries++;
      continue;
    }

    if (response.status >= 500) {
      const waitMs =
        AMAZON_CONFIG.INITIAL_RETRY_DELAY_MS * Math.pow(2, retries);
      await sleep(waitMs);
      retries++;
      continue;
    }

    const errorText = await response.text();
    throw new Error(`Ads API error (${response.status}): ${errorText}`);
  }

  throw new Error("Ads API: Max retries exceeded");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================
// Profiles
// ============================================

interface AdsProfile {
  profileId: number;
  countryCode: string;
  currencyCode: string;
  timezone: string;
  accountInfo: {
    marketplaceStringId: string;
    id: string;
    type: string;
    name: string;
  };
}

/**
 * Get advertising profiles (to find profile ID)
 */
export async function getProfiles(): Promise<AdsProfile[]> {
  return adsApiRequest<AdsProfile[]>({
    path: "/v2/profiles",
  });
}

// ============================================
// Reporting API (v3)
// ============================================

interface ReportRequest {
  reportDate?: string;
  startDate?: string;
  endDate?: string;
  metrics: string[];
  groupBy?: string[];
}

interface ReportResponse {
  reportId: string;
  status: string;
  statusDetails?: string;
}

interface ReportStatusResponse {
  reportId: string;
  status: "IN_PROGRESS" | "SUCCESS" | "FAILURE";
  url?: string;
  failureReason?: string;
  fileSize?: number;
}

export interface AdsReportRow {
  date?: string;
  campaignName?: string;
  campaignId?: string;
  adGroupName?: string;
  advertisedAsin?: string;
  impressions?: number;
  clicks?: number;
  cost?: number;
  sales7d?: number;
  sales14d?: number;
  sales30d?: number;
  orders7d?: number;
  orders14d?: number;
  purchases7d?: number;
}

/**
 * Request a Sponsored Products campaign report
 */
export async function requestSpReport(
  startDate: string,
  endDate: string
): Promise<string> {
  const body = {
    name: `SP Report ${startDate} to ${endDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: ["campaign", "adGroup"],
      columns: [
        "date",
        "campaignName",
        "campaignId",
        "adGroupName",
        "impressions",
        "clicks",
        "cost",
        "purchases7d",
        "sales7d",
        "sales14d",
      ],
      reportTypeId: "spCampaigns",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  };

  const response = await adsApiRequest<ReportResponse>({
    method: "POST",
    path: "/reporting/reports",
    body,
  });

  return response.reportId;
}

/**
 * Request a Sponsored Products advertised product report (per ASIN)
 */
export async function requestSpProductReport(
  startDate: string,
  endDate: string
): Promise<string> {
  const body = {
    name: `SP Product Report ${startDate} to ${endDate}`,
    startDate,
    endDate,
    configuration: {
      adProduct: "SPONSORED_PRODUCTS",
      groupBy: ["advertiser"],
      columns: [
        "date",
        "advertisedAsin",
        "campaignName",
        "impressions",
        "clicks",
        "cost",
        "purchases7d",
        "sales7d",
        "sales14d",
      ],
      reportTypeId: "spAdvertisedProduct",
      timeUnit: "DAILY",
      format: "GZIP_JSON",
    },
  };

  const response = await adsApiRequest<ReportResponse>({
    method: "POST",
    path: "/reporting/reports",
    body,
  });

  return response.reportId;
}

/**
 * Check report status
 */
export async function getReportStatus(
  reportId: string
): Promise<ReportStatusResponse> {
  return adsApiRequest<ReportStatusResponse>({
    path: `/reporting/reports/${reportId}`,
  });
}

/**
 * Download and parse report data
 */
export async function downloadReport(
  downloadUrl: string
): Promise<AdsReportRow[]> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Report download failed: ${response.status}`);
  }

  // Response is gzipped JSON
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Request report and poll until complete, then download
 */
export async function fetchSpProductReport(
  startDate: string,
  endDate: string
): Promise<AdsReportRow[]> {
  // 1. Request report
  const reportId = await requestSpProductReport(startDate, endDate);

  // 2. Poll for completion
  let attempts = 0;
  while (attempts < AMAZON_CONFIG.REPORT_MAX_POLL_ATTEMPTS) {
    await sleep(AMAZON_CONFIG.REPORT_POLL_INTERVAL_MS);

    const status = await getReportStatus(reportId);

    if (status.status === "SUCCESS" && status.url) {
      // 3. Download and return
      return downloadReport(status.url);
    }

    if (status.status === "FAILURE") {
      throw new Error(
        `Report generation failed: ${status.failureReason || "Unknown"}`
      );
    }

    attempts++;
  }

  throw new Error("Report generation timed out");
}

export type { AdsProfile, ReportStatusResponse };
