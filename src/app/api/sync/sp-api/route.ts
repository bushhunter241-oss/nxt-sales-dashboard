import { NextRequest, NextResponse } from "next/server";
import { syncOrders, syncInventory, syncTraffic, syncBSR } from "@/lib/sync/sp-api-sync";
import {
  startSyncLog,
  completeSyncLog,
  failSyncLog,
  isSyncRunning,
} from "@/lib/api/api-sync";

// Extend Vercel function timeout to 300s (Pro plan max)
export const maxDuration = 300;

// POST: Trigger SP-API sync
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { syncType = "orders", startDate, endDate } = body;

    // Determine API type for logging
    let apiType: "sp-api-orders" | "sp-api-inventory" | "sp-api-traffic" | "sp-api-bsr";
    if (syncType === "inventory") {
      apiType = "sp-api-inventory";
    } else if (syncType === "traffic") {
      apiType = "sp-api-traffic";
    } else if (syncType === "sp-api-bsr" || syncType === "bsr") {
      apiType = "sp-api-bsr";
    } else {
      apiType = "sp-api-orders";
    }

    // Check if sync is already running
    const running = await isSyncRunning(apiType);
    if (running) {
      return NextResponse.json(
        { error: "A sync is already running for this API type" },
        { status: 409 }
      );
    }

    // Default date range: last 7 days
    const end = endDate || new Date().toISOString().split("T")[0];
    const start =
      startDate ||
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

    // Create sync log
    const syncId = await startSyncLog(apiType, "manual", start, end);

    try {
      let result;

      if (syncType === "inventory") {
        result = await syncInventory();
      } else if (syncType === "traffic") {
        result = await syncTraffic(start, end);
      } else if (syncType === "sp-api-bsr" || syncType === "bsr") {
        result = await syncBSR();
      } else {
        result = await syncOrders(start, end);
      }

      // Complete sync log
      await completeSyncLog(syncId, result.recordsProcessed);

      return NextResponse.json({
        success: true,
        syncId,
        recordsProcessed: result.recordsProcessed,
        errors: result.errors.length > 0 ? result.errors : undefined,
        debug: result.debug,
      });
    } catch (syncError) {
      const errorMessage =
        syncError instanceof Error ? syncError.message : "Unknown sync error";
      await failSyncLog(syncId, errorMessage);

      return NextResponse.json(
        { error: errorMessage, syncId },
        { status: 500 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
