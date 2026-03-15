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

      // Poll for up to ~45s (fits within Vercel Hobby plan 60s limit)
      // If not ready, return pending so UI can auto-retry
      let attempts = 0;
      const maxAttempts = 9; // 9 × 5s = 45s (leave 15s margin)
      while (attempts < maxAttempts) {
        await sleep(5000);
        const status = await getReportStatus(pendingReportId);

        const s = status.status as string;
        if ((s === "COMPLETED" || s === "SUCCESS") && status.url) {
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

        if (s === "FAILURE") {
          const errMsg = `Report generation failed: ${status.failureReason || "Unknown"}`;
          await failSyncLog(syncId, errMsg);
          return NextResponse.json(
            { error: errMsg, syncId },
            { status: 500 }
          );
        }

        attempts++;
      }

      // Still not ready - return pending so UI can auto-retry
      return NextResponse.json(
        {
          pending: true,
          syncId,
          reportId: pendingReportId,
          attemptsUsed: attempts,
          message:
            "Report still generating. Will auto-retry shortly.",
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
