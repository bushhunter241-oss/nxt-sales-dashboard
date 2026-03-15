import { supabase } from "@/lib/supabase";
import { fetchSpProductReport } from "@/lib/amazon/ads-api";
import type { AdsReportRow } from "@/lib/amazon/ads-api";

interface SyncResult {
  recordsProcessed: number;
  errors: string[];
}

interface DailyAdAggregate {
  product_id: string;
  date: string;
  ad_spend: number;
  ad_sales: number;
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
      impressions: 0,
      clicks: 0,
      acos: 0,
      roas: 0,
      campaign_name: row.campaignName || null,
      campaign_type: "sp",
      source: "ads-api" as const,
    };

    existing.ad_spend += Math.round((row.cost || 0) * 100) / 100;
    existing.ad_sales += Math.round((row.sales14d || row.sales7d || 0) * 100) / 100;
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

  // 3. Upsert to daily_advertising
  const records = Array.from(aggregateMap.values());

  for (const record of records) {
    // Check if a record from ads-api already exists for this date+product
    const { data: existingRecord } = await supabase
      .from("daily_advertising")
      .select("id")
      .eq("product_id", record.product_id)
      .eq("date", record.date)
      .eq("source", "ads-api")
      .maybeSingle();

    if (existingRecord) {
      // Update existing
      const { error } = await supabase
        .from("daily_advertising")
        .update({
          ad_spend: record.ad_spend,
          ad_sales: record.ad_sales,
          impressions: record.impressions,
          clicks: record.clicks,
          acos: record.acos,
          roas: record.roas,
          campaign_name: record.campaign_name,
        })
        .eq("id", existingRecord.id);

      if (error) {
        errors.push(`Failed to update ad data for ${record.date}: ${error.message}`);
      } else {
        recordsProcessed++;
      }
    } else {
      // Insert new
      const { error } = await supabase
        .from("daily_advertising")
        .insert(record);

      if (error) {
        errors.push(`Failed to insert ad data for ${record.date}: ${error.message}`);
      } else {
        recordsProcessed++;
      }
    }
  }

  return { recordsProcessed, errors };
}

/**
 * Sync advertising data from Amazon Ads API to daily_advertising table.
 * Used by the cron job (single-phase, blocking).
 */
export async function syncAdvertising(
  startDate: string,
  endDate: string
): Promise<SyncResult> {
  // Fetch report from Ads API (this polls until complete)
  const reportData = await fetchSpProductReport(startDate, endDate);

  // Process and upsert the data
  return processAdsReportData(reportData, startDate, endDate);
}
