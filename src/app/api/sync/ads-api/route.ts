import { NextRequest, NextResponse } from "next/server";
import { syncAdvertising } from "@/lib/sync/ads-api-sync";
import {
  startSyncLog,
  completeSyncLog,
  failSyncLog,
  isSyncRunning,
} from "@/lib/api/api-sync";

// POST: Trigger Ads API sync
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { startDate, endDate } = body;

    // Check if sync is already running
    const running = await isSyncRunning("ads-api");
    if (running) {
      return NextResponse.json(
        { error: "A sync is already running for Ads API" },
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
    const syncId = await startSyncLog("ads-api", "manual", start, end);

    try {
      const result = await syncAdvertising(start, end);

      // Complete sync log
      await completeSyncLog(syncId, result.recordsProcessed);

      return NextResponse.json({
        success: true,
        syncId,
        recordsProcessed: result.recordsProcessed,
        errors: result.errors.length > 0 ? result.errors : undefined,
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
