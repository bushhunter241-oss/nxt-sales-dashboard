import { NextResponse } from "next/server";
import { syncOrders, syncInventory, syncTraffic, syncBSR } from "@/lib/sync/sp-api-sync";
import { syncAdvertising } from "@/lib/sync/ads-api-sync";
import {
  startSyncLog,
  completeSyncLog,
  failSyncLog,
  isSyncRunning,
} from "@/lib/api/api-sync";
import { getCredentials } from "@/lib/amazon/auth";
import { supabase } from "@/lib/supabase";
import { syncRakutenSales } from "@/lib/rakuten/sync";

// Extend Vercel function timeout to 300s (Pro plan max)
export const maxDuration = 300;

// Vercel Cron: GET /api/cron/sync
// Runs daily at 2:00 AM JST (configured in vercel.json)
export async function GET(request: Request) {
  // Verify cron secret (Vercel sets this header for cron jobs)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: {
    type: string;
    success: boolean;
    records?: number;
    error?: string;
  }[] = [];

  // Yesterday's date range
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dateStr = yesterday.toISOString().split("T")[0];

  // --- SP-API Orders Sync ---
  const spCreds = await getCredentials("sp-api");
  if (spCreds) {
    // 1. Orders
    if (!(await isSyncRunning("sp-api-orders"))) {
      const syncId = await startSyncLog("sp-api-orders", "cron", dateStr, dateStr);
      try {
        const result = await syncOrders(dateStr, dateStr);
        await completeSyncLog(syncId, result.recordsProcessed);
        results.push({
          type: "sp-api-orders",
          success: true,
          records: result.recordsProcessed,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        await failSyncLog(syncId, msg);
        results.push({ type: "sp-api-orders", success: false, error: msg });
      }
    }

    // 2. Inventory
    if (!(await isSyncRunning("sp-api-inventory"))) {
      const syncId = await startSyncLog("sp-api-inventory", "cron");
      try {
        const result = await syncInventory();
        await completeSyncLog(syncId, result.recordsProcessed);
        results.push({
          type: "sp-api-inventory",
          success: true,
          records: result.recordsProcessed,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        await failSyncLog(syncId, msg);
        results.push({ type: "sp-api-inventory", success: false, error: msg });
      }
    }

    // 3. Traffic (sessions)
    if (!(await isSyncRunning("sp-api-traffic"))) {
      const syncId = await startSyncLog("sp-api-traffic", "cron", dateStr, dateStr);
      try {
        const result = await syncTraffic(dateStr, dateStr);
        await completeSyncLog(syncId, result.recordsProcessed);
        results.push({
          type: "sp-api-traffic",
          success: true,
          records: result.recordsProcessed,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        await failSyncLog(syncId, msg);
        results.push({ type: "sp-api-traffic", success: false, error: msg });
      }
    }
    // 4. BSR Rankings
    if (!(await isSyncRunning("sp-api-bsr"))) {
      const syncId = await startSyncLog("sp-api-bsr", "cron");
      try {
        const result = await syncBSR();
        await completeSyncLog(syncId, result.recordsProcessed);
        results.push({
          type: "sp-api-bsr",
          success: true,
          records: result.recordsProcessed,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        await failSyncLog(syncId, msg);
        results.push({ type: "sp-api-bsr", success: false, error: msg });
      }
    }
  } else {
    results.push({
      type: "sp-api",
      success: false,
      error: "No SP-API credentials configured",
    });
  }

  // --- Ads API Sync ---
  const adsCreds = await getCredentials("ads-api");
  if (adsCreds) {
    if (!(await isSyncRunning("ads-api"))) {
      const syncId = await startSyncLog("ads-api", "cron", dateStr, dateStr);
      try {
        const result = await syncAdvertising(dateStr, dateStr);
        await completeSyncLog(syncId, result.recordsProcessed);
        results.push({
          type: "ads-api",
          success: true,
          records: result.recordsProcessed,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        await failSyncLog(syncId, msg);
        results.push({ type: "ads-api", success: false, error: msg });
      }
    }
  } else {
    results.push({
      type: "ads-api",
      success: false,
      error: "No Ads API credentials configured",
    });
  }

  // --- 楽天 RMS API Sync ---
  try {
    const { data: rakutenCred } = await supabase
      .from("rakuten_api_credentials")
      .select("*")
      .single();

    if (rakutenCred) {
      try {
        const result = await syncRakutenSales(
          {
            serviceSecret: rakutenCred.service_secret,
            licenseKey: rakutenCred.license_key,
          },
          dateStr,
          dateStr
        );
        results.push({
          type: "rakuten-orders",
          success: result.success,
          records: result.salesUpserted ?? 0,
          error: result.success ? undefined : result.message,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        results.push({ type: "rakuten-orders", success: false, error: msg });
      }
    } else {
      results.push({
        type: "rakuten",
        success: false,
        error: "No Rakuten RMS credentials configured",
      });
    }
  } catch {
    // rakuten_api_credentials table may not exist yet
    results.push({
      type: "rakuten",
      success: false,
      error: "Rakuten credentials table not found",
    });
  }

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    results,
  });
}
