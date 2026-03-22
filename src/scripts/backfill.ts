/**
 * Backfill script: Re-syncs SP-API orders and traffic data for a date range.
 *
 * Calls the Vercel-deployed API endpoints in small chunks to avoid timeouts.
 * No service_role key needed locally — runs entirely via the deployed API.
 *
 * Usage:
 *   npx tsx src/scripts/backfill.ts
 *
 * Configuration: edit BACKFILL_CONFIG below.
 */

const BACKFILL_CONFIG = {
  /** Vercel deployment URL */
  baseUrl: "https://nxt-sales-dashboard.vercel.app",

  /** Date range to backfill (inclusive, YYYY-MM-DD) */
  startDate: "2026-01-01",
  endDate: "2026-03-22",

  /** Days per chunk for orders sync (3 days = safe for Vercel 5min limit) */
  ordersChunkDays: 1,

  /** Days per chunk for traffic sync */
  trafficChunkDays: 7,

  /** Wait time after a chunk completes before starting next (ms) */
  delayBetweenChunks: 5_000,

  /** Max retries per chunk on failure */
  maxRetries: 3,

  /** Wait time when sync is already running (ms) — must exceed 10min auto-expire */
  staleSyncWaitMs: 11 * 60 * 1000,

  /** Skip orders sync (set true if you only need traffic) */
  skipOrders: false,

  /** Skip traffic sync (set true if you only need orders) */
  skipTraffic: false,

  /** Cleanup: delete old catch-all product data before syncing */
  cleanupCatchAll: false,
};

// ─── Helpers ──────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function splitDateRange(
  start: string,
  end: string,
  chunkDays: number
): Array<{ startDate: string; endDate: string }> {
  const chunks: Array<{ startDate: string; endDate: string }> = [];
  let current = start;
  while (current <= end) {
    const chunkEnd = addDays(current, chunkDays - 1);
    chunks.push({
      startDate: current,
      endDate: chunkEnd > end ? end : chunkEnd,
    });
    current = addDays(current, chunkDays);
  }
  return chunks;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${s % 60}s` : `${s}s`;
}

function now(): string {
  return new Date().toLocaleTimeString("ja-JP");
}

async function waitForStaleSyncExpiry(): Promise<void> {
  const waitMin = Math.ceil(BACKFILL_CONFIG.staleSyncWaitMs / 60_000);
  console.log(`  ⏳ Stale sync detected. Waiting ${waitMin}min for auto-expire... (${now()})`);
  await sleep(BACKFILL_CONFIG.staleSyncWaitMs);
  console.log(`  ⏳ Wait complete. Retrying... (${now()})`);
}

async function callSyncApi(
  syncType: string,
  startDate: string,
  endDate: string,
  attempt: number = 1
): Promise<{ success: boolean; recordsProcessed?: number; errors?: string[]; error?: string }> {
  const url = `${BACKFILL_CONFIG.baseUrl}/api/sync/sp-api`;
  const body = JSON.stringify({ syncType, startDate, endDate });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6 * 60 * 1000); // 6min client timeout

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // Handle non-JSON responses (Vercel timeout returns HTML)
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      if (attempt <= BACKFILL_CONFIG.maxRetries) {
        console.log(`  ⚠ Non-JSON response (${res.status}): Vercel likely timed out.`);
        await waitForStaleSyncExpiry();
        return callSyncApi(syncType, startDate, endDate, attempt + 1);
      }
      return { success: false, error: `Non-JSON response: ${text.slice(0, 100)}` };
    }

    const data = await res.json();

    if (res.status === 409) {
      if (attempt <= BACKFILL_CONFIG.maxRetries) {
        await waitForStaleSyncExpiry();
        return callSyncApi(syncType, startDate, endDate, attempt + 1);
      }
      return { success: false, error: "Sync still running after retries" };
    }

    if (!res.ok) {
      return { success: false, error: data.error || `HTTP ${res.status}` };
    }

    return {
      success: true,
      recordsProcessed: data.recordsProcessed,
      errors: data.errors,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("abort") || msg.includes("timeout");

    if (attempt <= BACKFILL_CONFIG.maxRetries) {
      if (isTimeout) {
        console.log(`  ⚠ Request timed out (client-side 6min limit).`);
        await waitForStaleSyncExpiry();
      } else {
        console.log(`  ⚠ Request failed: ${msg}. Waiting 30s before retry...`);
        await sleep(30_000);
      }
      return callSyncApi(syncType, startDate, endDate, attempt + 1);
    }
    return { success: false, error: msg };
  }
}

async function cleanupCatchAllData(): Promise<void> {
  console.log("\n── Cleanup: checking for catch-all products ──");
  try {
    const res = await fetch(`${BACKFILL_CONFIG.baseUrl}/api/admin/cleanup-catchall`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: BACKFILL_CONFIG.startDate,
        endDate: BACKFILL_CONFIG.endDate,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`  Cleanup result: ${JSON.stringify(data)}`);
    } else if (res.status === 404) {
      console.log("  Cleanup endpoint not found — skipping");
    } else {
      console.log(`  Cleanup failed: HTTP ${res.status}`);
    }
  } catch {
    console.log("  Cleanup endpoint unavailable — skipping");
  }
}

// ─── Main ──────────────────────────────────────────────────

async function main() {
  const { startDate, endDate, skipOrders, skipTraffic, cleanupCatchAll } = BACKFILL_CONFIG;

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║      SP-API Backfill Script  v2              ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log(`  Period:  ${startDate} → ${endDate}`);
  console.log(`  Orders:  ${skipOrders ? "SKIP" : `${BACKFILL_CONFIG.ordersChunkDays}-day chunks`}`);
  console.log(`  Traffic: ${skipTraffic ? "SKIP" : `${BACKFILL_CONFIG.trafficChunkDays}-day chunks`}`);
  console.log(`  Target:  ${BACKFILL_CONFIG.baseUrl}`);
  console.log(`  Started: ${now()}`);
  console.log("");

  const totalStart = Date.now();
  let totalRecords = 0;
  const allErrors: string[] = [];

  // Step 0: Cleanup catch-all data
  if (cleanupCatchAll) {
    await cleanupCatchAllData();
  }

  // Step 1: Orders sync
  if (!skipOrders) {
    const chunks = splitDateRange(startDate, endDate, BACKFILL_CONFIG.ordersChunkDays);
    console.log(`\n── Orders Sync (${chunks.length} chunks, ${BACKFILL_CONFIG.ordersChunkDays} days each) ──`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkStart = Date.now();
      console.log(`\n  [${i + 1}/${chunks.length}] Orders: ${chunk.startDate} → ${chunk.endDate}  (${now()})`);

      const result = await callSyncApi("orders", chunk.startDate, chunk.endDate);

      if (result.success) {
        const elapsed = formatDuration(Date.now() - chunkStart);
        console.log(`  ✓ ${result.recordsProcessed} records (${elapsed})`);
        totalRecords += result.recordsProcessed || 0;
        if (result.errors && result.errors.length > 0) {
          console.log(`  ⚠ ${result.errors.length} warnings`);
          allErrors.push(...result.errors.map((e) => `[Orders ${chunk.startDate}] ${e}`));
        }
      } else {
        console.log(`  ✗ Failed: ${result.error}`);
        allErrors.push(`[Orders ${chunk.startDate}-${chunk.endDate}] ${result.error}`);
      }

      if (i < chunks.length - 1) {
        await sleep(BACKFILL_CONFIG.delayBetweenChunks);
      }
    }
  }

  // Step 2: Traffic sync
  if (!skipTraffic) {
    const chunks = splitDateRange(startDate, endDate, BACKFILL_CONFIG.trafficChunkDays);
    console.log(`\n── Traffic Sync (${chunks.length} chunks, ${BACKFILL_CONFIG.trafficChunkDays} days each) ──`);

    // Wait between orders and traffic to let any stale sync expire
    if (!skipOrders) {
      console.log("  Waiting 15s before starting traffic sync...");
      await sleep(15_000);
    }

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkStart = Date.now();
      console.log(`\n  [${i + 1}/${chunks.length}] Traffic: ${chunk.startDate} → ${chunk.endDate}  (${now()})`);

      const result = await callSyncApi("traffic", chunk.startDate, chunk.endDate);

      if (result.success) {
        const elapsed = formatDuration(Date.now() - chunkStart);
        console.log(`  ✓ ${result.recordsProcessed} records (${elapsed})`);
        totalRecords += result.recordsProcessed || 0;
        if (result.errors && result.errors.length > 0) {
          console.log(`  ⚠ ${result.errors.length} warnings`);
          allErrors.push(...result.errors.map((e) => `[Traffic ${chunk.startDate}] ${e}`));
        }
      } else {
        console.log(`  ✗ Failed: ${result.error}`);
        allErrors.push(`[Traffic ${chunk.startDate}-${chunk.endDate}] ${result.error}`);
      }

      if (i < chunks.length - 1) {
        await sleep(BACKFILL_CONFIG.delayBetweenChunks);
      }
    }
  }

  // Summary
  const totalElapsed = formatDuration(Date.now() - totalStart);
  console.log("\n══════════════════════════════════════════════");
  console.log(`  Total records: ${totalRecords}`);
  console.log(`  Total time:    ${totalElapsed}`);
  console.log(`  Finished:      ${now()}`);
  if (allErrors.length > 0) {
    console.log(`  Warnings/Errors: ${allErrors.length}`);
    for (const e of allErrors.slice(0, 30)) {
      console.log(`    - ${e}`);
    }
    if (allErrors.length > 30) {
      console.log(`    ... and ${allErrors.length - 30} more`);
    }
  } else {
    console.log("  No errors!");
  }
  console.log("══════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
