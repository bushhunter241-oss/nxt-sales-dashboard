// Amazon API Configuration for Japanese Marketplace

export const AMAZON_CONFIG = {
  // Japan Marketplace
  MARKETPLACE_ID: "A1VC38T7YXB528",
  MARKETPLACE_COUNTRY: "JP",

  // SP-API endpoints (Far East region)
  SP_API_ENDPOINT: "https://sellingpartnerapi-fe.amazon.com",
  LWA_TOKEN_URL: "https://api.amazon.co.jp/auth/o2/token",

  // Ads API endpoints (Far East)
  ADS_API_ENDPOINT: "https://advertising-api-fe.amazon.com",
  ADS_AUTH_URL: "https://api.amazon.co.jp/auth/o2/token",

  // Rate limits
  SP_API_RATE_LIMIT: 3, // requests per second (conservative)
  ADS_API_RATE_LIMIT: 10, // requests per second

  // Retry config
  MAX_RETRIES: 3,
  INITIAL_RETRY_DELAY_MS: 1000,

  // Report polling
  REPORT_POLL_INTERVAL_MS: 10000, // 10 seconds
  REPORT_MAX_POLL_ATTEMPTS: 60, // 10 minutes max
} as const;

// SP-API Report Types
export const SP_API_REPORT_TYPES = {
  SALES_AND_TRAFFIC: "GET_SALES_AND_TRAFFIC_REPORT",
  FBA_INVENTORY: "GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA",
  ORDERS: "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL",
} as const;

// Ads API Report Types
export const ADS_REPORT_TYPES = {
  SP_CAMPAIGNS: "spCampaigns",
  SP_TARGETING: "spTargeting",
  SP_ADVERTISED_PRODUCT: "spAdvertisedProduct",
} as const;
