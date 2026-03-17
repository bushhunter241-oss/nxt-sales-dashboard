import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const maxDuration = 60;

/**
 * POST /api/rakuten/advertising
 * 楽天RPP広告パフォーマンスレポートCSVをアップロード→パース→DB取り込み
 *
 * 楽天RMSのRPPパフォーマンスレポートCSV形式:
 * - Shift_JIS or UTF-8 encoding
 * - ヘッダー行あり
 * - 主要カラム: 日付, 商品管理番号, 商品名, 実績額, 売上金額, クリック, 表示回数 等
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, message: "CSVファイルが添付されていません" },
        { status: 400 }
      );
    }

    // CSVテキスト読み取り
    const buffer = await file.arrayBuffer();

    // Shift_JIS → UTF-8 変換を試みる
    let csvText: string;
    try {
      const decoder = new TextDecoder("shift_jis");
      csvText = decoder.decode(buffer);
    } catch {
      csvText = new TextDecoder("utf-8").decode(buffer);
    }

    // BOM除去
    if (csvText.charCodeAt(0) === 0xfeff) {
      csvText = csvText.slice(1);
    }

    const lines = csvText.split(/\r?\n/).filter((l) => l.trim());

    if (lines.length < 2) {
      return NextResponse.json(
        { success: false, message: "CSVにデータ行がありません" },
        { status: 400 }
      );
    }

    // ヘッダー解析
    const headerLine = lines[0];
    const headers = parseCSVLine(headerLine);
    const headerMap = mapHeaders(headers);

    if (!headerMap.date || !headerMap.productId) {
      return NextResponse.json({
        success: false,
        message: `必須カラムが見つかりません。検出ヘッダー: ${headers.join(", ")}`,
        headers,
      });
    }

    // データ行をパース
    const records: Array<{
      product_id: string;
      product_name: string;
      date: string;
      ad_spend: number;
      ad_sales: number;
      impressions: number;
      clicks: number;
      campaign_type: string;
    }> = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length < 3) continue;

      const rawDate = headerMap.date != null ? (cols[headerMap.date] || "") : "";
      const date = normalizeDate(rawDate);
      if (!date) continue;

      const productId = headerMap.productId != null ? (cols[headerMap.productId] || "").trim() : "";
      if (!productId) continue;

      const productName = headerMap.productName != null
        ? (cols[headerMap.productName] || "").trim()
        : "";

      records.push({
        product_id: productId,
        product_name: productName,
        date,
        ad_spend: parseNum(headerMap.adSpend != null ? cols[headerMap.adSpend] : undefined),
        ad_sales: parseNum(headerMap.adSales != null ? cols[headerMap.adSales] : undefined),
        impressions: parseNum(headerMap.impressions != null ? cols[headerMap.impressions] : undefined),
        clicks: parseNum(headerMap.clicks != null ? cols[headerMap.clicks] : undefined),
        campaign_type: headerMap.campaignType != null
          ? (cols[headerMap.campaignType] || "RPP").trim()
          : "RPP",
      });
    }

    if (records.length === 0) {
      return NextResponse.json({
        success: false,
        message: "パース可能なレコードが0件でした",
      });
    }

    // 商品マスタ upsert
    const uniqueProducts = new Map<string, string>();
    for (const r of records) {
      if (!uniqueProducts.has(r.product_id)) {
        uniqueProducts.set(r.product_id, r.product_name);
      }
    }

    const productIdMap: Record<string, string> = {};

    for (const [pid, pname] of uniqueProducts) {
      // 既存の商品を検索
      const { data: existing } = await supabase
        .from("rakuten_products")
        .select("id, product_id")
        .eq("product_id", pid)
        .single();

      if (existing) {
        productIdMap[pid] = existing.id;
      } else {
        // 新規作成
        const { data: newProduct, error: insertErr } = await supabase
          .from("rakuten_products")
          .insert({
            name: pname || pid,
            product_id: pid,
            selling_price: 0,
            cost_price: 0,
            fee_rate: 0,
            is_archived: false,
          })
          .select("id")
          .single();

        if (insertErr || !newProduct) {
          console.warn(`商品登録失敗: ${pid}`, insertErr);
          continue;
        }
        productIdMap[pid] = newProduct.id;
      }
    }

    // 広告データ upsert (日付×商品で集約)
    const aggKey = (date: string, pid: string) => `${date}|${pid}`;
    const aggregated = new Map<
      string,
      {
        product_id: string;
        date: string;
        ad_spend: number;
        ad_sales: number;
        impressions: number;
        clicks: number;
        campaign_type: string;
      }
    >();

    for (const r of records) {
      const dbProductId = productIdMap[r.product_id];
      if (!dbProductId) continue;

      const key = aggKey(r.date, dbProductId);
      const existing = aggregated.get(key);

      if (existing) {
        existing.ad_spend += r.ad_spend;
        existing.ad_sales += r.ad_sales;
        existing.impressions += r.impressions;
        existing.clicks += r.clicks;
      } else {
        aggregated.set(key, {
          product_id: dbProductId,
          date: r.date,
          ad_spend: r.ad_spend,
          ad_sales: r.ad_sales,
          impressions: r.impressions,
          clicks: r.clicks,
          campaign_type: r.campaign_type,
        });
      }
    }

    let upserted = 0;
    let errors = 0;

    for (const row of aggregated.values()) {
      const acos = row.ad_sales > 0 ? (row.ad_spend / row.ad_sales) * 100 : 0;
      const roas = row.ad_spend > 0 ? row.ad_sales / row.ad_spend : 0;

      const { error: upsertErr } = await supabase
        .from("rakuten_daily_advertising")
        .upsert(
          {
            product_id: row.product_id,
            date: row.date,
            ad_spend: row.ad_spend,
            ad_sales: row.ad_sales,
            impressions: row.impressions,
            clicks: row.clicks,
            acos,
            roas,
            campaign_type: row.campaign_type,
            source: "csv" as const,
          },
          { onConflict: "product_id,date" }
        );

      if (upsertErr) {
        console.warn("upsert error:", upsertErr);
        errors++;
      } else {
        upserted++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `CSVインポート完了: ${records.length}行パース → ${aggregated.size}件集約 → ${upserted}件登録${errors > 0 ? `, ${errors}件エラー` : ""}`,
      parsed: records.length,
      aggregated: aggregated.size,
      upserted,
      errors,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "CSVインポートに失敗しました";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}

// ── ヘルパー関数 ──

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

interface HeaderMap {
  date: number | undefined;
  productId: number | undefined;
  productName: number | undefined;
  adSpend: number | undefined;
  adSales: number | undefined;
  impressions: number | undefined;
  clicks: number | undefined;
  campaignType: number | undefined;
}

function mapHeaders(headers: string[]): HeaderMap {
  const map: HeaderMap = {
    date: undefined,
    productId: undefined,
    productName: undefined,
    adSpend: undefined,
    adSales: undefined,
    impressions: undefined,
    clicks: undefined,
    campaignType: undefined,
  };

  headers.forEach((h, i) => {
    const normalized = h.trim().replace(/"/g, "");

    // 日付
    if (/日付|date|期間/i.test(normalized)) {
      map.date = i;
    }
    // 商品管理番号
    if (/商品管理番号|商品ID|product.*id|管理番号/i.test(normalized)) {
      map.productId = i;
    }
    // 商品名
    if (/商品名|product.*name/i.test(normalized) && !/管理/.test(normalized)) {
      map.productName = i;
    }
    // 広告費 (実績額, 広告費用, 消化金額, cost, spend)
    if (/実績額|広告費|消化金額|cost|spend|利用金額|請求金額/i.test(normalized) && !/売上/.test(normalized)) {
      map.adSpend = i;
    }
    // 広告売上
    if (/売上金額|売上額|広告売上|ad.*sales|revenue|広告経由売上/i.test(normalized)) {
      map.adSales = i;
    }
    // インプレッション
    if (/表示回数|imp|インプレッション|impression/i.test(normalized)) {
      map.impressions = i;
    }
    // クリック
    if (/クリック|click/i.test(normalized) && !/率/.test(normalized) && !/CPC/.test(normalized)) {
      map.clicks = i;
    }
    // キャンペーンタイプ
    if (/キャンペーン|campaign|広告タイプ|広告種別/i.test(normalized)) {
      map.campaignType = i;
    }
  });

  return map;
}

function normalizeDate(raw: string): string | null {
  const trimmed = raw.trim().replace(/"/g, "");

  // yyyy/MM/dd or yyyy-MM-dd
  const m1 = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (m1) {
    return `${m1[1]}-${m1[2].padStart(2, "0")}-${m1[3].padStart(2, "0")}`;
  }

  // MM/dd/yyyy
  const m2 = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m2) {
    return `${m2[3]}-${m2[1].padStart(2, "0")}-${m2[2].padStart(2, "0")}`;
  }

  return null;
}

function parseNum(val: string | undefined): number {
  if (!val) return 0;
  const cleaned = val.trim().replace(/[",¥￥%]/g, "").replace(/,/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}
