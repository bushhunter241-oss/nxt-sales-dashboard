import { supabase } from "@/lib/supabase";
import { fetchSpProductReport, fetchSpCampaignReport } from "@/lib/amazon/ads-api";
import type { AdsReportRow, AdsCampaignReportRow } from "@/lib/amazon/ads-api";

interface SyncResult {
  recordsProcessed: number;
  errors: string[];
}

interface DailyAdAggregate {
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
  source: "ads-api";
}

/**
 * Process already-downloaded Ads report data and upsert to daily_advertising.
 * Used by the 2-phase sync route after downloading the report.
 */
export async function processAdsReportData(
  reportData: AdsReportRow[],
  startDate: string,
  endDate: string
): Promise<SyncResult> {
  const errors: string[] = [];
  let recordsProcessed = 0;

  // 1. Get all products for ASIN mapping
  const { data: products } = await supabase
    .from("products")
    .select("id, asin")
    .eq("is_archived", false);

  if (!products || products.length === 0) {
    return { recordsProcessed: 0, errors: ["No products found in database"] };
  }

  const asinToProductId = new Map<string, string>();
  for (const p of products) {
    if (p.asin) asinToProductId.set(p.asin, p.id);
  }

  if (reportData.length === 0) {
    return { recordsProcessed: 0, errors: [] };
  }

  // 2. Aggregate by date + ASIN
  const aggregateMap = new Map<string, DailyAdAggregate>();

  for (const row of reportData) {
    if (!row.advertisedAsin || !row.date) {
      continue;
    }

    const productId = asinToProductId.get(row.advertisedAsin);
    if (!productId) {
      errors.push(`Unknown advertised ASIN: ${row.advertisedAsin}`);
      continue;
    }

    const key = `${productId}_${row.date}`;
    const existing = aggregateMap.get(key) || {
      product_id: productId,
      date: row.date,
      ad_spend: 0,
      ad_sales: 0,
      ad_orders: 0,
      impressions: 0,
      clicks: 0,
      acos: 0,
      roas: 0,
      campaign_name: row.campaignName || null,
      campaign_type: "sp",
      source: "ads-api" as const,
    };

    existing.ad_spend += Math.round(row.cost || 0);
    existing.ad_sales += Math.round(row.sales14d || row.sales7d || 0);
    existing.ad_orders += row.purchases14d || row.purchases7d || row.orders14d || row.orders7d || 0;
    existing.impressions += row.impressions || 0;
    existing.clicks += row.clicks || 0;

    // Recalculate ACOS and ROAS
    if (existing.ad_sales > 0) {
      existing.acos =
        Math.round((existing.ad_spend / existing.ad_sales) * 10000) / 100;
      existing.roas =
        Math.round((existing.ad_sales / existing.ad_spend) * 100) / 100;
    }

    aggregateMap.set(key, existing);
  }

  // 3. Upsert to daily_advertising (uses UNIQUE constraint on product_id, date, campaign_type)
  const records = Array.from(aggregateMap.values());

  for (const record of records) {
    const { error } = await supabase
      .from("daily_advertising")
      .upsert(record, { onConflict: "product_id,date,campaign_type" });

    if (error) {
      errors.push(`Failed to upsert ad data for ${record.date}: ${error.message}`);
    } else {
      recordsProcessed++;
    }
  }

  return { recordsProcessed, errors };
}

/**
 * Build campaign_name → product_group mapping from existing data
 */
async function buildCampaignToGroupMap(): Promise<Map<string, string>> {
  const { data } = await supabase
    .from("daily_advertising")
    .select("campaign_name, product:products(product_group)")
    .not("campaign_name", "is", null);

  const map = new Map<string, string>();
  for (const row of data || []) {
    const group = (row as any).product?.product_group;
    if (row.campaign_name && group && !map.has(row.campaign_name)) {
      map.set(row.campaign_name, group);
    }
  }
  return map;
}

/**
 * Process campaign-level report data and upsert to daily_campaign_advertising.
 * This gives accurate campaign-level spend without ASIN double-counting.
 */
export async function processCampaignReportData(
  reportData: AdsCampaignReportRow[],
  campaignToGroup: Map<string, string>
): Promise<SyncResult> {
  const errors: string[] = [];
  let recordsProcessed = 0;

  if (reportData.length === 0) {
    return { recordsProcessed: 0, errors: [] };
  }

  // Aggregate by campaign_name + date
  const aggregateMap = new Map<string, any>();

  for (const row of reportData) {
    if (!row.campaignName || !row.date) continue;

    const key = `${row.campaignName}_${row.date}`;
    const existing = aggregateMap.get(key) || {
      campaign_name: row.campaignName,
      campaign_id: row.campaignId || null,
      date: row.date,
      ad_spend: 0,
      ad_sales: 0,
      ad_orders: 0,
      impressions: 0,
      clicks: 0,
      acos: 0,
      roas: 0,
      product_group: campaignToGroup.get(row.campaignName) || null,
      source: "ads-api",
    };

    existing.ad_spend += Math.round(row.cost || 0);
    existing.ad_sales += Math.round(row.sales7d || 0);
    existing.ad_orders += row.purchases7d || 0;
    existing.impressions += row.impressions || 0;
    existing.clicks += row.clicks || 0;

    if (existing.ad_sales > 0) {
      existing.acos = Math.round((existing.ad_spend / existing.ad_sales) * 10000) / 100;
      existing.roas = Math.round((existing.ad_sales / existing.ad_spend) * 100) / 100;
    }

    aggregateMap.set(key, existing);
  }

  const records = Array.from(aggregateMap.values());

  for (const record of records) {
    const { error } = await supabase
      .from("daily_campaign_advertising")
      .upsert(record, { onConflict: "campaign_name,date" });

    if (error) {
      errors.push(`Failed to upsert campaign ad: ${error.message}`);
    } else {
      recordsProcessed++;
    }
  }

  return { recordsProcessed, errors };
}

/**
 * Sync advertising data from Amazon Ads API to daily_advertising + daily_campaign_advertising.
 * Fetches both product-level (ASIN) and campaign-level reports in parallel.
 * Used by the cron job (single-phase, blocking).
 */
export async function syncAdvertising(
  startDate: string,
  endDate: string
): Promise<SyncResult> {
  // Fetch both reports in parallel from Amazon Ads API
  const [productReport, campaignReport] = await Promise.all([
    fetchSpProductReport(startDate, endDate),
    fetchSpCampaignReport(startDate, endDate),
  ]);

  // Process product-level data (existing - ASIN level, may double-count)
  const productResult = await processAdsReportData(productReport, startDate, endDate);

  // Build campaign → product_group mapping from existing product-level data
  const campaignToGroup = await buildCampaignToGroupMap();

  // Process campaign-level data (new - accurate campaign totals)
  const campaignResult = await processCampaignReportData(campaignReport, campaignToGroup);

  return {
    recordsProcessed: productResult.recordsProcessed + campaignResult.recordsProcessed,
    errors: [...productResult.errors, ...campaignResult.errors],
  };
}
