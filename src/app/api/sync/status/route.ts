import { NextRequest, NextResponse } from "next/server";
import { getSyncLogs, getLastSyncTime, isSyncRunning } from "@/lib/api/api-sync";

// GET: Get sync status and history
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const apiType = searchParams.get("apiType") as
      | "sp-api-orders"
      | "sp-api-inventory"
      | "ads-api"
      | undefined;
    const limit = parseInt(searchParams.get("limit") || "20");

    // Get sync logs
    const logs = await getSyncLogs(limit, apiType || undefined);

    // Get last sync times and running status for each API type
    const apiTypes = ["sp-api-orders", "sp-api-inventory", "ads-api"] as const;
    const status: Record<
      string,
      { lastSync: string | null; isRunning: boolean }
    > = {};

    await Promise.all(
      apiTypes.map(async (type) => {
        const [lastSync, running] = await Promise.all([
          getLastSyncTime(type),
          isSyncRunning(type),
        ]);
        status[type] = { lastSync, isRunning: running };
      })
    );

    return NextResponse.json({
      status,
      logs,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
