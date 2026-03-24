import { supabase } from "@/lib/supabase";

export interface MonthlyOverride {
  year_month: string;   // 'YYYY-MM'
  total_sales: number;
  total_orders: number;
  total_units: number;
  sessions: number;
  cvr: number;
}

/** 全角円・カンマを除去して数値に変換 */
function parseMoney(str: string): number {
  return Math.round(parseFloat(str.replace(/[￥¥,\s"]/g, "")) || 0);
}

/** "5.57%" → 5.57 */
function parsePercent(str: string): number {
  return parseFloat(str.replace("%", "")) || 0;
}

/** "16,779" → 16779 */
function parseCount(str: string): number {
  return parseInt(str.replace(/[,"\s]/g, "")) || 0;
}

/** CSVテキストを MonthlyOverride[] に変換 */
export function parseMonthlySummaryCsv(csvText: string): MonthlyOverride[] {
  const lines = csvText.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];

  // BOMを除去
  const header = lines[0].replace(/^\uFEFF/, "");
  const cols = header.split(",");

  const idx = {
    date: cols.findIndex(c => c.includes("日付")),
    sales: cols.findIndex(c => c.includes("注文商品の売上額") && !c.includes("B2B")),
    orders: cols.findIndex(c => c.includes("注文された商品点数") && !c.includes("B2B")),
    units: cols.findIndex(c => c.includes("注文品目総数") && !c.includes("B2B")),
    sessions: cols.findIndex(c => c.includes("セッション数 - 合計") && !c.includes("B2B")),
    cvr: cols.findIndex(c => c.includes("注文商品セッション率") && !c.includes("B2B")),
  };

  const results: MonthlyOverride[] = [];

  for (let i = 1; i < lines.length; i++) {
    // カンマ区切りだが金額にカンマが含まれるため、ダブルクォート対応のパースが必要
    const row = parseCSVLine(lines[i]);
    if (!row[idx.date]) continue;

    // 日付: "2026/01/01" → "2026-01"
    const dateParts = row[idx.date].replace(/"/g, "").split("/");
    if (dateParts.length < 2) continue;
    const year_month = `${dateParts[0]}-${dateParts[1].padStart(2, "0")}`;

    results.push({
      year_month,
      total_sales: parseMoney(row[idx.sales] || "0"),
      total_orders: parseCount(row[idx.orders] || "0"),
      total_units: parseCount(row[idx.units] || "0"),
      sessions: parseCount(row[idx.sessions] || "0"),
      cvr: parsePercent(row[idx.cvr] || "0"),
    });
  }

  return results;
}

/** ダブルクォートを考慮したCSV行パーサー */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { result.push(current); current = ""; }
    else { current += ch; }
  }
  result.push(current);
  return result;
}

/** MonthlyOverride[] をSupabaseにupsertする */
export async function upsertMonthlyOverrides(overrides: MonthlyOverride[]): Promise<{ saved: number; errors: string[] }> {
  const errors: string[] = [];
  let saved = 0;

  for (const o of overrides) {
    const { error } = await supabase
      .from("amazon_monthly_overrides")
      .upsert(
        { ...o, source: "csv", imported_at: new Date().toISOString() },
        { onConflict: "year_month" }
      );
    if (error) {
      errors.push(`${o.year_month}: ${error.message}`);
    } else {
      saved++;
    }
  }

  return { saved, errors };
}

/** 月別オーバーライドを全件取得 */
export async function getMonthlyOverrides(): Promise<Record<string, MonthlyOverride>> {
  const { data } = await supabase
    .from("amazon_monthly_overrides")
    .select("*")
    .order("year_month", { ascending: false });

  const map: Record<string, MonthlyOverride> = {};
  for (const row of data || []) {
    map[row.year_month] = row;
  }
  return map;
}

/** 広告レポートCSVテキストを MonthlyAdOverride[] に変換 */
export function parseMonthlyAdSummaryCsv(csvText: string): MonthlyAdOverride[] {
  const lines = csvText.split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];

  // BOMを除去
  const header = lines[0].replace(/^\uFEFF/, "");
  const cols = header.split(",");

  const idx = {
    date: cols.findIndex(c => c.includes("日付") || c.includes("開始日") || c.includes("Date") || c.includes("Start")),
    spend: cols.findIndex(c => c.includes("広告費") || c.includes("費用") || c.includes("Spend")),
    sales: cols.findIndex(c => c.includes("売上") || c.includes("Sales")),
    orders: cols.findIndex(c => c.includes("注文") || c.includes("Orders")),
    impressions: cols.findIndex(c => c.includes("インプレッション") || c.includes("Impressions")),
    clicks: cols.findIndex(c => c.includes("クリック") || c.includes("Clicks")),
  };

  // 月別に集計するためのマップ
  const monthMap: Record<string, MonthlyAdOverride> = {};

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    const dateRaw = row[idx.date]?.replace(/"/g, "").trim();
    if (!dateRaw) continue;

    // 日付パース: 複数形式に対応
    let year_month = "";
    // "2026/01/01" or "2026-01-01"
    const isoMatch = dateRaw.match(/^(\d{4})[\/\-](\d{1,2})/);
    if (isoMatch) {
      year_month = `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}`;
    } else {
      // "Jan 01, 2026" or "January 01, 2026"
      const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
      const engMatch = dateRaw.match(/^([A-Za-z]{3})\w*\s+\d{1,2},?\s+(\d{4})/);
      if (engMatch) {
        const mm = MONTHS[engMatch[1].slice(0, 3)] || "01";
        year_month = `${engMatch[2]}-${mm}`;
      }
    }
    if (!year_month) continue;

    if (!monthMap[year_month]) {
      monthMap[year_month] = {
        year_month,
        total_ad_spend: 0,
        total_ad_sales: 0,
        total_ad_orders: 0,
        total_impressions: 0,
        total_clicks: 0,
      };
    }

    const m = monthMap[year_month];
    m.total_ad_spend += parseMoney(row[idx.spend] || "0");
    m.total_ad_sales += parseMoney(row[idx.sales] || "0");
    m.total_ad_orders += parseCount(row[idx.orders] || "0");
    m.total_impressions += parseCount(row[idx.impressions] || "0");
    m.total_clicks += parseCount(row[idx.clicks] || "0");
  }

  return Object.values(monthMap);
}

// ── 月別広告費オーバーライド ──────────────────────────

export interface MonthlyAdOverride {
  year_month: string;   // 'YYYY-MM'
  total_ad_spend: number;
  total_ad_sales: number;
  total_ad_orders: number;
  total_impressions: number;
  total_clicks: number;
}

/** MonthlyAdOverride[] をSupabaseにupsertする */
export async function upsertMonthlyAdOverrides(overrides: MonthlyAdOverride[]): Promise<{ saved: number; errors: string[] }> {
  const errors: string[] = [];
  let saved = 0;

  for (const o of overrides) {
    const { error } = await supabase
      .from("amazon_monthly_ad_overrides")
      .upsert(
        { ...o, source: "csv", imported_at: new Date().toISOString() },
        { onConflict: "year_month" }
      );
    if (error) {
      errors.push(`${o.year_month}: ${error.message}`);
    } else {
      saved++;
    }
  }

  return { saved, errors };
}

/** 月別広告費オーバーライドを全件取得 */
export async function getMonthlyAdOverrides(): Promise<Record<string, MonthlyAdOverride>> {
  const { data } = await supabase
    .from("amazon_monthly_ad_overrides")
    .select("*")
    .order("year_month", { ascending: false });

  const map: Record<string, MonthlyAdOverride> = {};
  for (const row of data || []) {
    map[row.year_month] = row;
  }
  return map;
}
