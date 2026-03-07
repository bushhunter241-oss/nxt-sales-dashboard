import { supabase } from "@/lib/supabase";
import type { ApiSyncLog } from "@/types/database";

type ApiType = "sp-api-orders" | "sp-api-inventory" | "ads-api";
type SyncType = "manual" | "cron";

/**
 * Create a new sync log entry (status: running)
 */
export async function startSyncLog(
  apiType: ApiType,
  syncType: SyncType = "manual",
  startDate?: string,
  endDate?: string
): Promise<string> {
  const { data, error } = await supabase
    .from("api_sync_logs")
    .insert({
      api_type: apiType,
      sync_type: syncType,
      status: "running",
      start_date: startDate || null,
      end_date: endDate || null,
      sync_started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create sync log: ${error?.message}`);
  }

  return data.id;
}

/**
 * Mark sync as completed successfully
 */
export async function completeSyncLog(
  syncId: string,
  recordsProcessed: number
): Promise<void> {
  await supabase
    .from("api_sync_logs")
    .update({
      status: "success",
      records_processed: recordsProcessed,
      sync_completed_at: new Date().toISOString(),
    })
    .eq("id", syncId);
}

/**
 * Mark sync as failed
 */
export async function failSyncLog(
  syncId: string,
  errorMessage: string,
  recordsProcessed: number = 0
): Promise<void> {
  await supabase
    .from("api_sync_logs")
    .update({
      status: "failed",
      error_message: errorMessage,
      records_processed: recordsProcessed,
      sync_completed_at: new Date().toISOString(),
    })
    .eq("id", syncId);
}

/**
 * Get recent sync logs
 */
export async function getSyncLogs(
  limit: number = 20,
  apiType?: ApiType
): Promise<ApiSyncLog[]> {
  let query = supabase
    .from("api_sync_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (apiType) {
    query = query.eq("api_type", apiType);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("getSyncLogs error:", error);
    return [];
  }

  return (data || []) as ApiSyncLog[];
}

/**
 * Get the last successful sync time for a given API type
 */
export async function getLastSyncTime(
  apiType: ApiType
): Promise<string | null> {
  const { data } = await supabase
    .from("api_sync_logs")
    .select("sync_completed_at")
    .eq("api_type", apiType)
    .eq("status", "success")
    .order("sync_completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.sync_completed_at || null;
}

/**
 * Check if a sync is currently running for a given API type
 */
export async function isSyncRunning(apiType: ApiType): Promise<boolean> {
  const { data } = await supabase
    .from("api_sync_logs")
    .select("id")
    .eq("api_type", apiType)
    .eq("status", "running")
    .limit(1)
    .maybeSingle();

  return !!data;
}
