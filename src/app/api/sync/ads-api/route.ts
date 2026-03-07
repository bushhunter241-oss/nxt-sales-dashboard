import { NextRequest, NextResponse } from "next/server";
import {
  requestSpProductReport,
  getReportStatus,
  downloadReport,
} from "@/lib/amazon/ads-api";
import { processAdsReportData } from "@/lib/sync/ads-api-sync";
import { supabase } from "@/lib/supabase";
import {
  startSyncLog,
  completeSyncLog,
  failSyncLog,
  isSyncRunning,
} from "@/lib/api/api-sync";

// Extend Vercel function timeout to 300s (Pro plan max)
export const maxDuration = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// POST: Trigger Ads API sync (2-phase: request → poll)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { startDate, endDate } = body;

    // Phase 2: Check for a pending report from a previous call
    const { data: pendingLogs } = await supabase
      .from("api_sync_logs")
      .select("id, error_message, start_date, end_date")
      .eq("api_type", "ads-api")
      .eq("status", "running")
      .ilike("error_message", "PENDING_REPORT:%")
      .order("created_at", { ascending: false })
      .limit(1);

    const pendingLog = pendingLogs?.[0];

    if (pendingLog) {
      // Resume: poll for the pending report
      const pendingReportId = pendingLog.error_message.replace(
        "PENDING_REPORT:",
        ""
      );
      const pendingStart = pendingLog.start_date;
      const pendingEnd = pendingLog.end_date;
      const syncId = pendingLog.id;

      // Poll for up to 270s (fits within 300s maxDuration)
      let attempts = 0;
      while (attempts < 45) {
        await sleep(5000);
        const status = await getReportStatus(pendingReportId);

        if ((status.status === "COMPLETED" || status.status === "SUCCESS") && status.url) {
          // Download and process
          const reportData = await downloadReport(status.url);
          const result = await processAdsReportData(
            reportData,
            pendingStart,
            pendingEnd
          );
          await completeSyncLog(syncId, result.recordsProcessed);
          return NextResponse.json({
            success: true,
            syncId,
            recordsProcessed: result.recordsProcessed,
            errors: result.errors.length > 0 ? result.errors : undefined,
          });
        }

        if (status.status === "FAILURE") {
          const errMsg = `Report generation failed: ${status.failureReason || "Unknown"}`;
          await failSyncLog(syncId, errMsg);
          return NextResponse.json(
            { error: errMsg, syncId },
            { status: 500 }
          );
        }

        attempts++;
      }

      // Still not ready after 270s - return pending so user can call again
      return NextResponse.json(
        {
          pending: true,
          syncId,
          reportId: pendingReportId,
          message:
            "Report still generating. Click sync again to check status.",
        },
        { status: 202 }
      );
    }

    // Phase 1: No pending report - start fresh
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
      // Request report from Amazon Ads API (fast, ~2s)
      const reportId = await requestSpProductReport(start, end);

      // Save reportId to sync log so Phase 2 can resume it
      await supabase
        .from("api_sync_logs")
        .update({ error_message: `PENDING_REPORT:${reportId}` })
        .eq("id", syncId);

      // Return immediately - report is generating on Amazon's side
      return NextResponse.json(
        {
          pending: true,
          syncId,
          reportId,
          startDate: start,
          endDate: end,
          message:
            "Report requested. Amazon is generating it (takes 3-10 min). Click sync again to check status.",
        },
        { status: 202 }
      );
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
